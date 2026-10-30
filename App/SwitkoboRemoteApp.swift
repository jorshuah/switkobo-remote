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
                    if let profile = store.selected, !connection.isConnected, !connection.isConnecting { connection.connect(profile) }
                }
                .onChange(of: scenePhase) { _, phase in
                    if phase == .background { connection.disconnect() }
                    if phase == .active, let tv = store.selected, !connection.isConnected, !connection.isConnecting {
                        connection.connect(tv)
                    }
                }
                .alert("Settings could not be saved", isPresented: Binding(get: { store.error != nil }, set: { if !$0 { store.error = nil } })) {
                    Button("Close", role: .cancel) { store.error = nil }
                } message: { Text(store.error ?? "") }
        }
    }
}
