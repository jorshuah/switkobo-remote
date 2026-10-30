import XCTest
@testable import RemoteCore

final class RemoteCoreTests: XCTestCase {
    func testRejectsNonLocalAndAmbiguousDestinations() throws {
        for input in ["https://192.168.1.2", "127.0.0.1", "8.8.8.8", "192.168.1.256", "192.168.1.255", "192.168.01.2", "10.0.0.1/path", "::1", "172.32.1.2", "10.0.0.1@evil.com"] {
            XCTAssertThrowsError(try LocalAddress.normalize(input), input)
        }
        XCTAssertEqual(try LocalAddress.normalize(" 172.16.2.3 "), "172.16.2.3")
    }
    func testPairingURLCannotInjectQueryParameters() throws {
        let url = try SamsungProtocol.endpoint(address: "192.168.1.20", token: "a&name=evil+/")
        let parts = try XCTUnwrap(URLComponents(url: url, resolvingAgainstBaseURL: false))
        XCTAssertEqual(parts.scheme, "wss")
        XCTAssertEqual(parts.port, 8002)
        XCTAssertEqual(parts.queryItems?.filter { $0.name == "name" }.count, 1)
        XCTAssertEqual(parts.queryItems?.first { $0.name == "token" }?.value, "a&name=evil+/")
    }
    func testUnicodeKeyboardRoundTripAndBound() throws {
        let text = "Search: café, 日本語, \"quoted\""
        let commands = try SamsungProtocol.text(text)
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(commands[1].utf8)) as? [String: Any])
        let params = try XCTUnwrap(object["params"] as? [String: Any])
        let encoded = try XCTUnwrap(params["Cmd"] as? String)
        XCTAssertEqual(String(data: try XCTUnwrap(Data(base64Encoded: encoded)), encoding: .utf8), text)
        XCTAssertThrowsError(try SamsungProtocol.text(String(repeating: "x", count: 2_001)))
    }
    func testAuthorizationEventsAreNotTransportOpenEvents() throws {
        XCTAssertEqual(try TVEvent.parse(Data(#"{"event":"ms.channel.ready"}"#.utf8)), .other)
        XCTAssertEqual(try TVEvent.parse(Data(#"{"event":"ms.channel.connect","data":{"token":123}}"#.utf8)), .authorized(token: "123"))
        XCTAssertEqual(try TVEvent.parse(Data(#"{"event":"ms.channel.unauthorized"}"#.utf8)), .unauthorized)
        XCTAssertThrowsError(try TVEvent.parse(Data("not json".utf8)))
    }
    func testAppResponseSkipsMalformedAndDuplicateRows() throws {
        let response = #"{"event":"ed.installedApp.get","data":{"data":[{"name":"Example","appId":"123","app_type":2},{"name":"Duplicate","appId":"123"},{"name":"Broken","appId":"../bad"}]}}"#
        guard case .apps(let apps) = try TVEvent.parse(Data(response.utf8)) else { return XCTFail("Expected app list") }
        XCTAssertEqual(apps.count, 1)
        XCTAssertTrue(apps[0].deepLink)
    }
    func testWakePacketMatchesHardwareAddressSixteenTimes() throws {
        let packet = try WakePacket.make(mac: "A0-B1-C2-D3-E4-F5")
        XCTAssertEqual(packet.count, 102)
        XCTAssertEqual(Array(packet.prefix(6)), Array(repeating: 255, count: 6))
        for offset in stride(from: 6, to: 102, by: 6) {
            XCTAssertEqual(Array(packet[offset..<(offset + 6)]), [160,177,194,211,228,245])
        }
        XCTAssertThrowsError(try WakePacket.make(mac: "FF:FF:FF:FF:FF:FF"))
    }
}
