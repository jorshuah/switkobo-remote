import Foundation

public enum RemoteError: LocalizedError {
    case invalidAddress, invalidMAC, invalidText, invalidApp, disconnected, overloaded
    public var errorDescription: String? {
        switch self {
        case .invalidAddress: return "Enter the TV’s local IPv4 address, such as 192.168.1.25."
        case .invalidMAC: return "Enter six pairs of hexadecimal digits for the MAC address."
        case .invalidText: return "Enter between 1 and 2,000 characters."
        case .invalidApp: return "Enter an app name and a valid Samsung app ID."
        case .disconnected: return "Connect to your TV before sending a command."
        case .overloaded: return "The TV connection is busy. Wait a moment and try again."
        }
    }
}

public enum LocalAddress {
    // No hostnames, URLs, loopback, multicast, or public network destinations.
    public static func normalize(_ input: String) throws -> String {
        let text = input.trimmingCharacters(in: .whitespacesAndNewlines)
        let parts = text.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count == 4,
              parts.allSatisfy({ !$0.isEmpty && $0.utf8.allSatisfy { (48...57).contains($0) } }),
              parts.allSatisfy({ $0.count == 1 || $0.first != "0" }) else { throw RemoteError.invalidAddress }
        let bytes = parts.compactMap { UInt8($0) }
        guard bytes.count == 4 else { throw RemoteError.invalidAddress }
        let local = bytes[0] == 10 || (bytes[0] == 172 && (16...31).contains(bytes[1])) ||
            (bytes[0] == 192 && bytes[1] == 168) || (bytes[0] == 169 && bytes[1] == 254)
        guard local, bytes[3] != 0, bytes[3] != 255 else { throw RemoteError.invalidAddress }
        return bytes.map(String.init).joined(separator: ".")
    }
}

public struct AppShortcut: Codable, Identifiable, Equatable, Sendable {
    public var id: UUID
    public var name: String
    public var appID: String
    public var deepLink: Bool
    public init(id: UUID = UUID(), name: String, appID: String, deepLink: Bool = true) {
        self.id = id; self.name = name; self.appID = appID; self.deepLink = deepLink
    }
    public func validated() throws -> Self {
        let name = name.trimmingCharacters(in: .whitespacesAndNewlines)
        let appID = appID.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty, name.count <= 60, !appID.isEmpty, appID.count <= 160,
              appID.unicodeScalars.allSatisfy({ CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "._-")).contains($0) })
        else { throw RemoteError.invalidApp }
        return Self(id: id, name: name, appID: appID, deepLink: deepLink)
    }
}

public struct TVProfile: Codable, Identifiable, Equatable, Sendable {
    public var id: UUID
    public var name: String
    public var address: String
    public var mac: String
    public var shortcuts: [AppShortcut]
    public init(id: UUID = UUID(), name: String = "Samsung Q65B", address: String = "", mac: String = "", shortcuts: [AppShortcut] = []) {
        self.id = id; self.name = name; self.address = address; self.mac = mac; self.shortcuts = shortcuts
    }
    public func validated() throws -> Self {
        var copy = self
        copy.address = try LocalAddress.normalize(address)
        copy.name = String(name.trimmingCharacters(in: .whitespacesAndNewlines).prefix(60))
        if copy.name.isEmpty { copy.name = "Samsung TV" }
        if !mac.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            copy.mac = try WakePacket.macBytes(mac).map { String(format: "%02X", $0) }.joined(separator: ":")
        } else { copy.mac = "" }
        copy.shortcuts = try shortcuts.map { try $0.validated() }
        return copy
    }
}

public enum RemoteKey: String, CaseIterable, Sendable {
    case up = "KEY_UP", down = "KEY_DOWN", left = "KEY_LEFT", right = "KEY_RIGHT", select = "KEY_ENTER"
    case home = "KEY_HOME", back = "KEY_RETURN", volumeUp = "KEY_VOLUP", volumeDown = "KEY_VOLDOWN", mute = "KEY_MUTE"
    case powerOff = "KEY_POWEROFF", source = "KEY_SOURCE", channelUp = "KEY_CHUP", channelDown = "KEY_CHDOWN"
    case play = "KEY_PLAY", pause = "KEY_PAUSE", stop = "KEY_STOP", rewind = "KEY_REWIND", forward = "KEY_FF"
    case guide = "KEY_GUIDE", info = "KEY_INFO", menu = "KEY_MENU", exit = "KEY_EXIT"
    case red = "KEY_RED", green = "KEY_GREEN", yellow = "KEY_YELLOW", blue = "KEY_BLUE"
    case zero = "KEY_0", one = "KEY_1", two = "KEY_2", three = "KEY_3", four = "KEY_4"
    case five = "KEY_5", six = "KEY_6", seven = "KEY_7", eight = "KEY_8", nine = "KEY_9"
}

public enum SamsungProtocol {
    public static func endpoint(address: String, token: String?) throws -> URL {
        var url = URLComponents()
        url.scheme = "wss"; url.host = try LocalAddress.normalize(address); url.port = 8002
        url.path = "/api/v2/channels/samsung.remote.control"
        url.queryItems = [.init(name: "name", value: Data("Switkobo Remote".utf8).base64EncodedString())]
        if let token, !token.isEmpty { url.queryItems?.append(.init(name: "token", value: token)) }
        url.percentEncodedQuery = url.percentEncodedQuery?.replacingOccurrences(of: "+", with: "%2B")
        guard let result = url.url else { throw RemoteError.invalidAddress }
        return result
    }

    private static func encode(_ method: String, _ params: [String: Any]) throws -> String {
        let data = try JSONSerialization.data(withJSONObject: ["method": method, "params": params], options: [.sortedKeys])
        return String(decoding: data, as: UTF8.self)
    }
    public static func key(_ key: RemoteKey) throws -> String {
        try encode("ms.remote.control", ["Cmd": "Click", "DataOfCmd": key.rawValue, "Option": "false", "TypeOfRemote": "SendRemoteKey"])
    }
    public static func text(_ text: String) throws -> [String] {
        guard !text.isEmpty, text.count <= 2_000 else { throw RemoteError.invalidText }
        return [
            try encode("ms.channel.emit", ["event": "custom.remote.textReceived", "to": "broadcast"]),
            try encode("ms.remote.control", ["Cmd": Data(text.utf8).base64EncodedString(), "DataOfCmd": "base64", "TypeOfRemote": "SendInputString"])
        ]
    }
    public static func launch(_ shortcut: AppShortcut) throws -> String {
        let app = try shortcut.validated()
        return try encode("ms.channel.emit", ["event": "ed.apps.launch", "to": "host", "data": [
            "appId": app.appID, "action_type": app.deepLink ? "DEEP_LINK" : "NATIVE_LAUNCH", "metaTag": ""
        ]])
    }
    public static func requestApps() throws -> String {
        try encode("ms.channel.emit", ["event": "ed.installedApp.get", "to": "host"])
    }
}

public enum TVEvent: Equatable, Sendable {
    case authorized(token: String?), unauthorized, keyboard(Bool), apps([AppShortcut]), failure, other
    public static func parse(_ data: Data) throws -> Self {
        guard data.count <= 1_048_576,
              let root = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let event = root["event"] as? String else { return .other }
        let body = root["data"] as? [String: Any] ?? [:]
        switch event {
        case "ms.channel.connect":
            let token = (body["token"] as? String) ?? (body["token"] as? NSNumber)?.stringValue
            return .authorized(token: token)
        case "ms.channel.unauthorized": return .unauthorized
        case "ms.remote.imeStart": return .keyboard(true)
        case "ms.remote.imeEnd": return .keyboard(false)
        case "ms.error": return .failure
        case "ed.installedApp.get":
            let rows = body["data"] as? [[String: Any]] ?? []
            var seen = Set<String>()
            let apps = rows.prefix(300).compactMap { row -> AppShortcut? in
                guard let name = row["name"] as? String, let id = row["appId"] as? String,
                      seen.insert(id).inserted else { return nil }
                let type = (row["app_type"] as? Int) ?? Int(row["app_type"] as? String ?? "")
                return try? AppShortcut(name: name, appID: id, deepLink: type == 2).validated()
            }
            return .apps(apps)
        default: return .other
        }
    }
}

public enum WakePacket {
    public static func macBytes(_ input: String) throws -> [UInt8] {
        let clean = input.trimmingCharacters(in: .whitespacesAndNewlines).replacingOccurrences(of: "-", with: ":")
        let parts = clean.split(separator: ":", omittingEmptySubsequences: false)
        let bytes = parts.compactMap { part -> UInt8? in part.count == 2 ? UInt8(part, radix: 16) : nil }
        guard bytes.count == 6, bytes.contains(where: { $0 != 0 }), bytes[0] & 1 == 0 else { throw RemoteError.invalidMAC }
        return bytes
    }
    public static func make(mac: String) throws -> Data {
        let bytes = try macBytes(mac)
        return Data(Array(repeating: UInt8(255), count: 6) + Array(repeating: bytes, count: 16).flatMap { $0 })
    }
}
