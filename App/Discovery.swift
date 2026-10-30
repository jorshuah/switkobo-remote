import Foundation
import Combine
import Darwin
import RemoteCore

struct NearbyTV: Identifiable {
    var id: String { address }
    var name: String
    var address: String
}

@MainActor
final class TVDiscovery: NSObject, ObservableObject, NetServiceBrowserDelegate, NetServiceDelegate {
    @Published private(set) var devices: [NearbyTV] = []
    @Published private(set) var searching = false
    @Published private(set) var message: String?
    private var browsers: [NetServiceBrowser] = []
    private var services: [NetService] = []
    private var timeout: Task<Void, Never>?

    func start() {
        stop(); devices = []; message = nil; searching = true
        // Bonjour does not require the restricted raw-multicast entitlement.
        for type in ["_samsungmsf._tcp.", "_airplay._tcp."] {
            let browser = NetServiceBrowser(); browser.delegate = self
            browsers.append(browser); browser.searchForServices(ofType: type, inDomain: "local.")
        }
        timeout = Task { [weak self] in
            do { try await Task.sleep(for: .seconds(8)) } catch { return }
            guard let self else { return }
            self.stop()
            if self.devices.isEmpty { self.message = "No nearby devices found. Enter the TV’s IP address below. Discovery may be unavailable on this TV or network." }
        }
    }
    func stop() {
        timeout?.cancel(); timeout = nil
        browsers.forEach { $0.stop(); $0.delegate = nil }; browsers = []
        services.forEach { $0.stop(); $0.delegate = nil }; services = []
        searching = false
    }
    func netServiceBrowser(_ browser: NetServiceBrowser, didFind service: NetService, moreComing: Bool) {
        services.append(service); service.delegate = self; service.resolve(withTimeout: 5)
    }
    func netServiceBrowser(_ browser: NetServiceBrowser, didNotSearch errorDict: [String: NSNumber]) {
        message = "Discovery could not start. Allow Local Network access in iPhone Settings, or enter the TV address manually."
    }
    func netServiceDidResolveAddress(_ sender: NetService) {
        for data in sender.addresses ?? [] {
            let address: String? = data.withUnsafeBytes { raw in
                guard let base = raw.baseAddress, raw.count >= MemoryLayout<sockaddr_in>.size else { return nil }
                let socketAddress = base.assumingMemoryBound(to: sockaddr.self)
                guard socketAddress.pointee.sa_family == sa_family_t(AF_INET) else { return nil }
                var host = [CChar](repeating: 0, count: Int(NI_MAXHOST))
                guard getnameinfo(socketAddress, socklen_t(data.count), &host, socklen_t(host.count), nil, 0, NI_NUMERICHOST) == 0 else { return nil }
                return try? LocalAddress.normalize(String(cString: host))
            }
            guard let address, !devices.contains(where: { $0.address == address }) else { continue }
            devices.append(.init(name: sender.name, address: address))
        }
    }
}
