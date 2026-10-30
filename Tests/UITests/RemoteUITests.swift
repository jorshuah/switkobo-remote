import XCTest

final class RemoteUITests: XCTestCase {
    func testFirstRunShowsHonestConnectionState() {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing"]
        app.launch()
        XCTAssertTrue(app.buttons["Connect a TV"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.staticTexts["Connected on your network"].exists)
        capture(app, name: "First connection")
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
        app.launchArguments = ["--ui-testing", "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"]
        app.launch()
        app.buttons["Remote settings"].tap()
        XCTAssertTrue(app.switches["Button haptics"].waitForExistence(timeout: 3))
        XCTAssertTrue(app.buttons["Add TV"].exists)
        capture(app, name: "Settings with accessibility text")
        let appearance = app.buttons["appearance-settings"]
        for _ in 0..<3 where !appearance.isHittable { app.swipeUp() }
        XCTAssertTrue(appearance.isHittable)
        appearance.tap()
        XCTAssertTrue(app.staticTexts["Dark"].waitForExistence(timeout: 3))
        capture(app, name: "Appearance choices with accessibility text")
    }
    func testSavedTVControlsStayDisabledUntilAuthorized() {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing", "--saved-tv"]
        app.launch()
        XCTAssertTrue(app.buttons["Connect to TV"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["Volume up"].isEnabled)
        XCTAssertFalse(app.staticTexts["Connected on your network"].exists)
        capture(app, name: "Saved TV disconnected")
        app.swipeUp()
        capture(app, name: "Disconnected remote controls")
    }
    private func capture(_ app: XCUIApplication, name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name; attachment.lifetime = .keepAlways
        add(attachment)
    }
}
