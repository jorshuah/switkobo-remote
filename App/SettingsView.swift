import SwiftUI
import RemoteCore

struct SettingsView: View {
    @EnvironmentObject private var store: LibraryStore
    @EnvironmentObject private var tv: SamsungConnection
    @State private var editing: TVProfile?
    @State private var forget: TVProfile?
    @State private var removing: TVProfile?
    @State private var message: String?
    var body: some View {
        Form {
            Section("Your TVs") {
                ForEach(store.library.profiles) { profile in
                    VStack(alignment: .leading, spacing: 8) {
                        Button { editing = profile } label: {
                            HStack { Label(profile.name, systemImage: "tv"); Spacer(); Image(systemName: "chevron.right") }.frame(minHeight: 48)
                        }
                        Text(profile.address).font(.footnote).foregroundStyle(.secondary)
                        HStack {
                            Button("Forget pairing") { forget = profile }.frame(minHeight: 48)
                            Spacer()
                            Button("Remove TV", role: .destructive) { removing = profile }.frame(minHeight: 48)
                        }.font(.callout)
                    }.buttonStyle(.borderless)
                }
                Button("Add TV", systemImage: "plus") { editing = TVProfile() }.frame(minHeight: 48)
            }
            Section("Preferences") {
                Toggle("Button haptics", isOn: Binding(get: { store.library.haptics }, set: { store.preferences(haptics: $0) }))
                NavigationLink { AppearanceSettingsView() } label: {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Appearance")
                        Text(store.library.appearance.title).font(.callout).foregroundStyle(.secondary)
                    }.fixedSize(horizontal: false, vertical: true).frame(minHeight: 48)
                }.accessibilityIdentifier("appearance-settings")
                Text("Preferences save immediately on this iPhone.").font(.footnote).foregroundStyle(.secondary)
            }
            Section("Connection help") {
                Text("Use the same local network as your TV. Guest Wi-Fi or client isolation can prevent pairing even when the Wi-Fi names match.")
                Text("On the TV, check Settings → All Settings → Connection → Network → Expert Settings for Power On with Mobile. Menu names can vary by region and firmware.")
                Text("If the TV rejects pairing, check External Device Manager → Device Connection Manager and allow this remote.")
                Button("Open iPhone app settings", systemImage: "gearshape") {
                    if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
                }.frame(minHeight: 48)
            }
            Section("About this remote") {
                Text("Switkobo Remote").font(.headline)
                Text("No ads, subscription, account, or home computer. TV commands travel directly over your local network. Pairing credentials are stored in this iPhone’s Keychain.")
                Text("Dictation uses on-device speech recognition when available. The app does not record audio to files or upload it to a speech service.")
                Text("Samsung Q65B is the first testing target. Keyboard entry, app launching, discovery, and standby wake depend on the TV and its apps. Touchpad gestures navigate focus; they do not provide a mouse pointer.")
                if let source = URL(string: "https://github.com/jorshuah/switkobo-remote") {
                    Link("View source code", destination: source).frame(minHeight: 48)
                }
                NavigationLink("Open-source license") { LicenseView() }.frame(minHeight: 48)
            }.font(.callout)
            if let message { Section { Text(message) } }
        }.navigationTitle("Settings")
            .sheet(item: $editing) { TVEditor(profile: $0) }
            .confirmationDialog("Forget this TV’s pairing?", isPresented: Binding(get: { forget != nil }, set: { if !$0 { forget = nil } }), titleVisibility: .visible) {
                Button("Forget pairing", role: .destructive) {
                    guard let profile = forget else { return }
                    tv.disconnect()
                    do { try PairingVault.remove(profile.id); message = "Pairing forgotten. Connect again and approve the new request on the TV." }
                    catch { store.error = error.localizedDescription }
                    forget = nil
                }
                Button("Cancel", role: .cancel) { forget = nil }
            } message: { Text("The saved permission and TV certificate will be removed from this iPhone. Only do this for a TV you recognize.") }
            .confirmationDialog("Remove this saved TV?", isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }), titleVisibility: .visible) {
                Button("Remove TV", role: .destructive) {
                    guard let profile = removing else { return }
                    if store.selected?.id == profile.id { tv.disconnect() }
                    _ = store.remove(profile.id); removing = nil
                }
                Button("Cancel", role: .cancel) { removing = nil }
            } message: { Text("Its saved address, shortcuts, and pairing credentials will be removed.") }
    }
}

private struct AppearanceSettingsView: View {
    @EnvironmentObject private var store: LibraryStore
    var body: some View {
        Form {
            Picker("Appearance", selection: Binding(get: { store.library.appearance }, set: { store.preferences(appearance: $0) })) {
                ForEach(Appearance.allCases, id: \.self) { appearance in
                    Text(appearance.title).fixedSize(horizontal: false, vertical: true).tag(appearance)
                }
            }.pickerStyle(.inline).labelsHidden()
        }.navigationTitle("Appearance").navigationBarTitleDisplayMode(.inline)
    }
}

private struct LicenseView: View {
    private var notice: String {
        guard let url = Bundle.main.url(forResource: "LICENSE", withExtension: nil),
              let text = try? String(contentsOf: url, encoding: .utf8) else {
            return "Switkobo Remote is available under the MIT license. View the full license in the source repository."
        }
        return text
    }
    var body: some View {
        ScrollView { Text(notice).font(.body).textSelection(.enabled).padding(24).frame(maxWidth: 640) }
            .navigationTitle("MIT license").navigationBarTitleDisplayMode(.inline)
    }
}

struct TVEditor: View {
    @EnvironmentObject private var store: LibraryStore
    @EnvironmentObject private var tv: SamsungConnection
    @Environment(\.dismiss) private var dismiss
    @StateObject private var discovery = TVDiscovery()
    @State private var draft: TVProfile
    @State private var validation: String?
    @State private var discard = false
    private let original: TVProfile
    init(profile: TVProfile) { original = profile; _draft = State(initialValue: profile) }
    private var dirty: Bool { draft != original }
    var body: some View {
        NavigationStack {
            Form {
                Section("TV details") {
                    TextField("TV name", text: $draft.name).textContentType(.nickname)
                    TextField("IP address", text: $draft.address).keyboardType(.decimalPad).textInputAutocapitalization(.never).autocorrectionDisabled()
                    Text("Find the IP address in the TV’s Network Status → IP Settings. Use a local address such as 192.168.1.25.").font(.footnote).foregroundStyle(.secondary)
                }
                Section("Nearby devices") {
                    Button { discovery.start() } label: {
                        HStack { if discovery.searching { ProgressView() }; Text(discovery.searching ? "Searching your network" : "Find nearby TVs").frame(minHeight: 48) }
                    }.disabled(discovery.searching)
                    ForEach(discovery.devices) { device in
                        Button {
                            draft.address = device.address
                            if original.address.isEmpty { draft.name = device.name }
                            discovery.stop()
                        } label: { VStack(alignment: .leading) { Text(device.name); Text(device.address).font(.footnote) }.frame(minHeight: 48) }
                    }
                    if let message = discovery.message { Text(message).font(.callout) }
                    Text("Nearby results can include other AirPlay devices. Select your Samsung TV; this remote’s connection protocol is Samsung-specific.").font(.footnote).foregroundStyle(.secondary)
                }
                Section("Standby wake") {
                    TextField("MAC address (optional)", text: $draft.mac).textInputAutocapitalization(.characters).autocorrectionDisabled()
                    Text("Use the TV’s network MAC address. Wake requests require Power On with Mobile and compatible standby/network behavior. If the TV does not wake, use its physical remote.").font(.footnote).foregroundStyle(.secondary)
                }
                Section("App shortcuts") {
                    ForEach(draft.shortcuts) { shortcut in
                        NavigationLink(shortcut.name) {
                            ShortcutEditor(shortcut: shortcut) { changed in
                                if let index = draft.shortcuts.firstIndex(where: { $0.id == changed.id }) { draft.shortcuts[index] = changed }
                            }
                        }
                    }.onDelete { draft.shortcuts.remove(atOffsets: $0) }
                    NavigationLink("Add app shortcut") { ShortcutEditor(shortcut: .init(name: "", appID: "")) { draft.shortcuts.append($0) } }
                    Text("You can also retrieve and save apps from the Apps screen after connecting.").font(.footnote).foregroundStyle(.secondary)
                }
                if let validation { Section { Text(validation).foregroundStyle(.red) } }
                Section {
                    Button("Save and connect") {
                        do {
                            let profile = try draft.validated()
                            if store.save(profile) { discovery.stop(); tv.connect(profile); dismiss() }
                            else { validation = store.error }
                        } catch { validation = error.localizedDescription }
                    }.frame(maxWidth: .infinity, minHeight: 48).buttonStyle(.borderedProminent)
                    Text("Approve Switkobo Remote on your TV. On first pairing, this iPhone remembers the TV’s certificate and checks it on future connections.").font(.footnote).foregroundStyle(.secondary)
                }
            }.navigationTitle(original.address.isEmpty ? "Connect a TV" : "Edit TV").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { if dirty { discard = true } else { dismiss() } } } }
                .confirmationDialog("Discard unsaved TV changes?", isPresented: $discard, titleVisibility: .visible) {
                    Button("Discard changes", role: .destructive) { dismiss() }
                    Button("Keep editing", role: .cancel) {}
                }
        }.interactiveDismissDisabled(dirty).onDisappear { discovery.stop() }
    }
}

struct ShortcutEditor: View {
    @Environment(\.dismiss) private var dismiss
    @State private var draft: AppShortcut
    @State private var error: String?
    @State private var discard = false
    private let original: AppShortcut
    let onSave: (AppShortcut) -> Void
    init(shortcut: AppShortcut, onSave: @escaping (AppShortcut) -> Void) {
        original = shortcut; _draft = State(initialValue: shortcut); self.onSave = onSave
    }
    var body: some View {
        Form {
            TextField("App name", text: $draft.name)
            TextField("Samsung app ID", text: $draft.appID).textInputAutocapitalization(.never).autocorrectionDisabled()
            Toggle("Use deep-link launch", isOn: $draft.deepLink)
            Text("App IDs vary by TV and region. Prefer the TV’s reported app list. Disable deep-link launch for apps that require native launch.").font(.footnote).foregroundStyle(.secondary)
            if let error { Text(error).foregroundStyle(.red) }
            Button("Save shortcut") {
                do { onSave(try draft.validated()); dismiss() }
                catch { self.error = error.localizedDescription }
            }.frame(minHeight: 48)
        }.navigationTitle("App shortcut").navigationBarTitleDisplayMode(.inline)
            .navigationBarBackButtonHidden(true)
            .interactiveDismissDisabled(draft != original)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { if draft != original { discard = true } else { dismiss() } }
                }
            }
            .confirmationDialog("Discard shortcut changes?", isPresented: $discard, titleVisibility: .visible) {
                Button("Discard changes", role: .destructive) { dismiss() }
                Button("Keep editing", role: .cancel) {}
            }
    }
}
