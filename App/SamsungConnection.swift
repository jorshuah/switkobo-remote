import Foundation
import Combine
import CryptoKit
import Security
import Network
import RemoteCore

// A separate delegate per TV session. Trust is scoped to this literal local address.
// First-use certificates are committed only after the TV grants remote permission.
final class TVTrustDelegate: NSObject, URLSessionDelegate, URLSessionTaskDelegate, @unchecked Sendable {
    let address: String
    let expected: String?
    private let lock = NSLock()
    private var fingerprint: String?
    private var changed = false
    var observed: String? { lock.withLock { fingerprint } }
    var certificateChanged: Bool { lock.withLock { changed } }

    init(address: String, expected: String?) { self.address = address; self.expected = expected }
    func urlSession(_ session: URLSession, didReceive challenge: URLAuthenticationChallenge,
                    completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        guard challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
              challenge.protectionSpace.host == address, challenge.protectionSpace.port == 8002,
              let trust = challenge.protectionSpace.serverTrust,
              let chain = SecTrustCopyCertificateChain(trust) as? [SecCertificate], let leaf = chain.first else {
            completionHandler(.cancelAuthenticationChallenge, nil); return
        }
        let hash = SHA256.hash(data: SecCertificateCopyData(leaf) as Data).map { String(format: "%02x", $0) }.joined()
        if let expected, expected != hash {
            lock.withLock { changed = true }
            completionHandler(.cancelAuthenticationChallenge, nil); return
        }
        lock.withLock { fingerprint = hash }
        completionHandler(.useCredential, URLCredential(trust: trust))
    }
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) {
        // Do not forward pairing credentials to redirects.
        completionHandler(nil)
    }
}

enum ConnectionState: Equatable {
    case disconnected, connecting, connected, failed(String)
    var label: String {
        switch self {
        case .disconnected: return "Not connected"
        case .connecting: return "Waiting for TV permission"
        case .connected: return "Connected on your network"
        case .failed: return "Connection needs attention"
        }
    }
}

@MainActor
final class SamsungConnection: ObservableObject {
    @Published private(set) var state: ConnectionState = .disconnected
    @Published var notice: String?
    @Published private(set) var keyboardActive = false
    @Published private(set) var installedApps: [AppShortcut] = []
    @Published private(set) var loadingApps = false
    @Published private(set) var waking = false
    @Published var draft = ""
    private var session: URLSession?
    private var socket: URLSessionWebSocketTask?
    private var delegate: TVTrustDelegate?
    private var receiver: Task<Void, Never>?
    private var deadline: Task<Void, Never>?
    private var heartbeat: Task<Void, Never>?
    private var appDeadline: Task<Void, Never>?
    private var sendTail: Task<Bool, Never>?
    private var generation = UUID()
    private var pending = 0
    private var powerOffRequested = false
    private var activeProfile: TVProfile?
    private var wakeConnection: NWConnection?
    private var wakeDeadline: Task<Void, Never>?
    var isConnected: Bool { state == .connected }
    var isConnecting: Bool { state == .connecting }

    func connect(_ profile: TVProfile) {
        disconnect()
        notice = nil; installedApps = []; activeProfile = profile
        do {
            let profile = try profile.validated()
            let saved = try PairingVault.read(profile.id)
            let pairing = saved?.address == profile.address ? saved : nil
            let url = try SamsungProtocol.endpoint(address: profile.address, token: pairing?.token)
            let trust = TVTrustDelegate(address: profile.address, expected: pairing?.certificate)
            let config = URLSessionConfiguration.ephemeral
            config.timeoutIntervalForRequest = 30
            config.timeoutIntervalForResource = 60 * 60
            config.waitsForConnectivity = false
            config.httpCookieStorage = nil
            config.urlCache = nil
            let session = URLSession(configuration: config, delegate: trust, delegateQueue: nil)
            let socket = session.webSocketTask(with: url)
            socket.maximumMessageSize = 1_048_576
            self.delegate = trust; self.session = session; self.socket = socket
            let current = generation
            state = .connecting
            socket.resume()
            receiver = Task { [weak self] in
                do {
                    while !Task.isCancelled {
                        let message = try await socket.receive()
                        let data: Data
                        switch message {
                        case .data(let bytes): data = bytes
                        case .string(let text): data = Data(text.utf8)
                        @unknown default: continue
                        }
                        guard let self, self.generation == current else { return }
                        try self.handle(TVEvent.parse(data), profile: profile, generation: current)
                    }
                } catch {
                    guard let self, self.generation == current, !Task.isCancelled else { return }
                    if self.powerOffRequested {
                        self.disconnect()
                        self.notice = "The TV connection closed after the power-off request. Check the TV before reconnecting."
                        return
                    }
                    let message = trust.certificateChanged
                        ? "This TV’s certificate changed. Check the TV address. If you replaced or reset the TV, forget its saved pairing in Settings and pair again."
                        : "Could not reach the TV. Check that it is on, both devices share the same Wi-Fi network, and Local Network access is enabled for this app in iPhone Settings."
                    self.fail(message)
                }
            }
            deadline = Task { [weak self] in
                do { try await Task.sleep(for: .seconds(30)) } catch { return }
                guard let self, self.generation == current, self.isConnecting else { return }
                self.fail("Pairing timed out. Turn on the TV, reconnect, and select Allow on its permission prompt. Check the TV’s Device Connection Manager if no prompt appears.")
            }
        } catch { fail(error.localizedDescription) }
    }

    private func handle(_ event: TVEvent, profile: TVProfile, generation current: UUID) throws {
        switch event {
        case .authorized(let token):
            guard let certificate = delegate?.observed else {
                fail("The TV’s secure identity could not be checked. Reconnect to try again."); return
            }
            do {
                let old = try PairingVault.read(profile.id)
                let savedToken = old?.address == profile.address ? old?.token : nil
                try PairingVault.save(.init(address: profile.address, token: token ?? savedToken, certificate: certificate), id: profile.id)
            } catch {
                fail("The TV allowed this remote, but its pairing could not be saved securely. Unlock your iPhone and reconnect.")
                return
            }
            deadline?.cancel(); state = .connected
            heartbeat?.cancel()
            heartbeat = Task { [weak self] in
                while !Task.isCancelled {
                    do { try await Task.sleep(for: .seconds(12)) } catch { return }
                    guard let self, self.generation == current, let socket = self.socket else { return }
                    let pingDeadline = Task { [weak self] in
                        do { try await Task.sleep(for: .seconds(5)) } catch { return }
                        guard let self, self.generation == current else { return }
                        self.fail("The TV stopped responding. Check its power and Wi-Fi, then reconnect.")
                    }
                    socket.sendPing { [weak self] error in
                        pingDeadline.cancel()
                        if error != nil {
                            Task { @MainActor in
                                guard let self, self.generation == current else { return }
                                self.fail("The TV connection was lost. Reconnect to continue.")
                            }
                        }
                    }
                }
            }
        case .unauthorized:
            fail("The TV did not allow this remote. Select Allow on the TV, or remove the blocked entry in its Device Connection Manager and reconnect.")
        case .keyboard(let active): keyboardActive = active
        case .apps(let apps): installedApps = apps; loadingApps = false; appDeadline?.cancel()
        case .failure: notice = "The TV rejected a request. This feature may not be supported on the current screen."
        case .other: break
        }
    }

    func disconnect() {
        generation = UUID()
        receiver?.cancel(); deadline?.cancel(); heartbeat?.cancel(); appDeadline?.cancel(); sendTail?.cancel()
        receiver = nil; deadline = nil; heartbeat = nil; appDeadline = nil; sendTail = nil
        socket?.cancel(with: .goingAway, reason: nil); socket = nil
        session?.invalidateAndCancel(); session = nil; delegate = nil
        wakeConnection?.cancel(); wakeConnection = nil; wakeDeadline?.cancel(); wakeDeadline = nil; waking = false
        pending = 0; powerOffRequested = false; keyboardActive = false; loadingApps = false; state = .disconnected
    }
    private func fail(_ message: String) { disconnect(); state = .failed(message) }

    // One ordered, bounded queue per live connection. Old commands cannot cross reconnects.
    private func send(_ payloads: [String]) async -> Bool {
        guard isConnected, let socket else { notice = RemoteError.disconnected.localizedDescription; return false }
        guard pending < 12 else { notice = RemoteError.overloaded.localizedDescription; return false }
        let current = generation
        let previous = sendTail
        pending += 1
        let task = Task { @MainActor [weak self] () -> Bool in
            _ = await previous?.value
            guard let self else { return false }
            defer { if self.generation == current { self.pending -= 1 } }
            guard !Task.isCancelled, self.generation == current, self.isConnected else { return false }
            do {
                for payload in payloads {
                    guard !Task.isCancelled, self.generation == current else { return false }
                    try await socket.send(.string(payload))
                    try await Task.sleep(for: .milliseconds(80))
                }
                return self.generation == current && self.isConnected
            } catch {
                if self.generation == current, !Task.isCancelled {
                    self.fail("The command could not be sent. Reconnect and try again.")
                }
                return false
            }
        }
        sendTail = task
        return await task.value
    }
    func key(_ key: RemoteKey) async {
        let current = generation
        if key == .powerOff { powerOffRequested = true }
        do {
            let sent = await send([try SamsungProtocol.key(key)])
            guard generation == current else { return }
            if key == .powerOff {
                powerOffRequested = false
                if sent {
                    disconnect()
                    notice = "Power-off request sent. Use Wake TV or the physical remote to turn the TV back on."
                }
            }
        }
        catch { notice = error.localizedDescription }
    }
    func sendDraft() async -> Bool {
        do {
            let sent = await send(try SamsungProtocol.text(draft))
            if sent { notice = "Text sent. Check the TV’s text field; some apps do not accept remote typing." }
            return sent
        } catch { notice = error.localizedDescription; return false }
    }
    func launch(_ shortcut: AppShortcut) async {
        do {
            if await send([try SamsungProtocol.launch(shortcut)]) {
                notice = "Launch request sent for \(shortcut.name)."
            }
        } catch { notice = error.localizedDescription }
    }
    func fetchApps() async {
        guard !loadingApps, isConnected else { return }
        loadingApps = true; installedApps = []
        do {
            guard await send([try SamsungProtocol.requestApps()]) else { loadingApps = false; return }
            guard loadingApps else { return }
            let current = generation
            appDeadline = Task { [weak self] in
                do { try await Task.sleep(for: .seconds(8)) } catch { return }
                guard let self, self.generation == current, self.loadingApps else { return }
                self.loadingApps = false
                self.notice = "This TV did not return an app list. You can add shortcuts by app ID in Settings."
            }
        } catch { loadingApps = false; notice = error.localizedDescription }
    }

    func wake(_ profile: TVProfile) {
        guard !waking else { return }
        do {
            let packet = try WakePacket.make(mac: profile.mac)
            let address = try LocalAddress.normalize(profile.address)
            // Unicast avoids an unrestricted subnet broadcast. Router/standby support varies.
            let connection = NWConnection(host: NWEndpoint.Host(address), port: 9, using: .udp)
            wakeConnection = connection; waking = true
            let current = generation
            connection.stateUpdateHandler = { [weak self] state in
                Task { @MainActor in
                    guard let self, self.generation == current, self.wakeConnection === connection else { return }
                    if case .ready = state {
                        connection.stateUpdateHandler = nil
                        connection.send(content: packet, completion: .contentProcessed { [weak self] error in
                            Task { @MainActor in
                                guard let self, self.generation == current, self.wakeConnection === connection else { return }
                                self.notice = error == nil
                                    ? "Wake request sent. If the TV wakes, tap Connect. Standby wake is not supported by every network."
                                    : "Could not send the wake request. Use the physical remote, then connect."
                                connection.cancel(); self.wakeConnection = nil; self.waking = false; self.wakeDeadline?.cancel()
                            }
                        })
                    } else if case .failed = state {
                        self.notice = "Could not reach the TV to wake it. Use the physical remote, then connect."
                        connection.cancel(); self.wakeConnection = nil; self.waking = false; self.wakeDeadline?.cancel()
                    }
                }
            }
            connection.start(queue: .global(qos: .userInitiated))
            wakeDeadline = Task { [weak self] in
                do { try await Task.sleep(for: .seconds(5)) } catch { return }
                guard let self, self.wakeConnection === connection else { return }
                connection.cancel(); self.wakeConnection = nil; self.waking = false
                self.notice = "Wake request timed out. Use the physical remote, then connect."
            }
        } catch { notice = error.localizedDescription }
    }
}
