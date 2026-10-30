import XCTest

final class RemoteUITests: XCTestCase {
    func testFirstRunShowsHonestConnectionState() {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing"]
        app.launch()
        XCTAssertTrue(app.buttons["Connect a TV"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.staticTexts["Connected on your network"].exists)
        app.buttons["Connect a TV"].tap()
        XCTAssertTrue(app.textFields["IP address"].waitForExistence(timeout: 3))
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "Connection form"; screenshot.lifetime = .keepAlways
        add(screenshot)
        app.buttons["Cancel"].tap()
        XCTAssertTrue(app.buttons["Connect a TV"].exists)
    }
    func testSettingsAreReachableBeforePairing() {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing"]
        app.launch()
        app.buttons["Remote settings"].tap()
        XCTAssertTrue(app.switches["Button haptics"].waitForExistence(timeout: 3))
        XCTAssertTrue(app.buttons["Add TV"].exists)
    }
}
