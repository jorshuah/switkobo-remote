import SwiftUI

@main
struct SwitkoboRemoteApp: App {
    @StateObject private var store = LibraryStore()
    @StateObject private var connection = SamsungConnection()
    @Environment(\.scenePhase) private var scenePhase
    var body: some Scene {
        WindowGroup {
            RemoteView()
                .environmentObject(store)
                .environmentObject(connection)
                .tint(Palette.accent)
                .preferredColorScheme(store.library.appearance == .system ? nil : (store.library.appearance == .dark ? .dark : .light))
                .task {
                    connectSavedTV()
                }
                .onChange(of: scenePhase) { _, phase in
                    if phase == .background { connection.disconnect() }
                    if phase == .active { connectSavedTV() }
                }
                .alert("Settings need attention", isPresented: Binding(get: { store.error != nil }, set: { if !$0 { store.error = nil } })) {
                    Button("Close", role: .cancel) { store.error = nil }
                } message: { Text(store.error ?? "") }
        }
    }
    private func connectSavedTV() {
#if DEBUG
        if ProcessInfo.processInfo.arguments.contains("--ui-testing") { return }
#endif
        if let profile = store.selected, !connection.isConnected, !connection.isConnecting { connection.connect(profile) }
    }
}
