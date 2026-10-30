import Foundation
import Combine
import Security
import RemoteCore

enum Appearance: String, Codable, CaseIterable { case system, light, dark }

struct RemoteLibrary: Codable {
    var version = 1
    var profiles: [TVProfile] = []
    var selectedID: UUID?
    var haptics = true
    var appearance: Appearance = .system
}

@MainActor
final class LibraryStore: ObservableObject {
    @Published private(set) var library = RemoteLibrary()
    @Published var error: String?
    private var loadFailed = false
    private let file: URL
    var selected: TVProfile? { library.profiles.first { $0.id == library.selectedID } }

    init() {
#if DEBUG
        if ProcessInfo.processInfo.arguments.contains("--ui-testing") {
            file = FileManager.default.temporaryDirectory.appending(path: "remote-ui-test-\(UUID().uuidString).json")
            if ProcessInfo.processInfo.arguments.contains("--saved-tv") {
                let fixture = TVProfile(name: "Samsung Q65B", address: "192.168.1.25")
                library.profiles = [fixture]; library.selectedID = fixture.id
            }
            return
        }
#endif
        file = URL.applicationSupportDirectory.appending(path: "SwitkoboRemote/library.json")
        do {
            if FileManager.default.fileExists(atPath: file.path) {
                let saved = try JSONDecoder().decode(RemoteLibrary.self, from: Data(contentsOf: file))
                guard saved.version == 1 else { throw CocoaError(.fileReadCorruptFile) }
                library = saved
            }
        } catch {
            loadFailed = true
            self.error = "Saved settings could not be read. Your existing file has been preserved. \(error.localizedDescription)"
        }
    }

    @discardableResult
    private func commit(_ next: RemoteLibrary) -> Bool {
        guard !loadFailed else { error = "Settings cannot be saved while the existing settings file is unreadable."; return false }
        do {
            try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
            let data = try JSONEncoder().encode(next)
            try data.write(to: file, options: [.atomic, .completeFileProtection])
            library = next
            return true
        } catch { self.error = "Could not save changes. \(error.localizedDescription)"; return false }
    }

    @discardableResult
    func save(_ profile: TVProfile) -> Bool {
        do {
            let value = try profile.validated()
            var next = library
            if let i = next.profiles.firstIndex(where: { $0.id == value.id }) { next.profiles[i] = value }
            else { next.profiles.append(value) }
            next.selectedID = value.id
            return commit(next)
        } catch { self.error = error.localizedDescription; return false }
    }

    @discardableResult
    func select(_ id: UUID) -> Bool {
        guard library.profiles.contains(where: { $0.id == id }) else { return false }
        var next = library; next.selectedID = id
        return commit(next)
    }

    @discardableResult
    func remove(_ id: UUID) -> Bool {
        do { try PairingVault.remove(id) }
        catch { self.error = error.localizedDescription; return false }
        var next = library
        next.profiles.removeAll { $0.id == id }
        if next.selectedID == id { next.selectedID = next.profiles.first?.id }
        return commit(next)
    }

    func preferences(haptics: Bool? = nil, appearance: Appearance? = nil) {
        var next = library
        if let haptics { next.haptics = haptics }
        if let appearance { next.appearance = appearance }
        _ = commit(next)
    }
}

struct PairingRecord: Codable {
    var address: String
    var token: String?
    var certificate: String
}

enum PairingVault {
    private static func query(_ id: UUID) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: "com.switkobo.remote.pairing",
         kSecAttrAccount as String: id.uuidString]
    }
    private static func check(_ status: OSStatus) throws {
        guard status == errSecSuccess else {
            throw NSError(domain: NSOSStatusErrorDomain, code: Int(status), userInfo: [NSLocalizedDescriptionKey: "Secure pairing storage is unavailable (\(status)). Unlock your iPhone and try again."])
        }
    }
    static func read(_ id: UUID) throws -> PairingRecord? {
        var q = query(id); q[kSecReturnData as String] = true; q[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(q as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        try check(status)
        guard let data = result as? Data else { throw CocoaError(.fileReadCorruptFile) }
        return try JSONDecoder().decode(PairingRecord.self, from: data)
    }
    static func save(_ value: PairingRecord, id: UUID) throws {
        let data = try JSONEncoder().encode(value)
        let attributes: [String: Any] = [kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly]
        let status = SecItemUpdate(query(id) as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            try check(SecItemAdd(query(id).merging(attributes) { _, new in new } as CFDictionary, nil))
        } else { try check(status) }
    }
    static func remove(_ id: UUID) throws {
        let status = SecItemDelete(query(id) as CFDictionary)
        if status != errSecItemNotFound { try check(status) }
    }
}
