import SwiftUI
import RemoteCore

struct KeyboardSheet: View {
    let startDictation: Bool
    @EnvironmentObject private var tv: SamsungConnection
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var speech = Dictation()
    @State private var sending = false
    @State private var prefix = ""
    @FocusState private var focused: Bool

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text(tv.keyboardActive ? "A TV text field is active" : "Open a search or text field on your TV first")
                        .font(.headline)
                    Text("Typing works only in TV apps that accept remote text. Dictation fills this draft; it does not activate Bixby.")
                        .font(.callout).foregroundStyle(.secondary)
                    TextEditor(text: $tv.draft)
                        .frame(minHeight: 150).focused($focused)
                        .accessibilityLabel("Text to send to TV")
                        .disabled(sending || speech.recording || speech.starting)
                    Text("\(tv.draft.count) / 2,000 characters").font(.footnote).foregroundStyle(tv.draft.count > 2000 ? Color.red : Color.secondary)
                }
                Section {
                    Button {
                        if speech.recording || speech.starting { speech.stop() }
                        else { beginDictation() }
                    } label: {
                        Label(speech.recording ? "Stop dictation" : (speech.starting ? "Cancel microphone setup" : "Dictate text"), systemImage: speech.recording ? "stop.circle" : "mic")
                            .frame(minHeight: 48)
                    }.disabled(sending)
                    if speech.recording { Label("Listening on this iPhone", systemImage: "waveform").foregroundStyle(Palette.accent) }
                    if speech.starting { ProgressView("Preparing microphone") }
                    if let error = speech.error { Text(error).font(.callout) }
                    Button {
                        sending = true; speech.stop(); focused = false
                        Task { _ = await tv.sendDraft(); sending = false }
                    } label: {
                        HStack { if sending { ProgressView() }; Text(sending ? "Sending text" : "Send text to TV") }
                            .frame(maxWidth: .infinity, minHeight: 48)
                    }.buttonStyle(.borderedProminent)
                        .disabled(!tv.isConnected || sending || speech.recording || speech.starting || tv.draft.isEmpty || tv.draft.count > 2000)
                    Button("Press Enter on TV") { Task { await tv.key(.select) } }
                        .frame(minHeight: 48).disabled(!tv.isConnected || sending || speech.recording)
                    Text("Your draft stays here until you clear it or close the app. Sending does not automatically submit the TV’s search form.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                if let notice = tv.notice { Section { Text(notice).font(.callout) } }
                Section {
                    Button("Clear draft", role: .destructive) { tv.draft = "" }
                        .disabled(sending || speech.recording || speech.starting || tv.draft.isEmpty)
                }
            }
            .navigationTitle("TV keyboard").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { speech.stop(); dismiss() }.disabled(sending) } }
        }
        .interactiveDismissDisabled(sending || speech.recording || speech.starting)
        .task {
            if startDictation {
                prefix = tv.draft.isEmpty ? "" : tv.draft + " "
                await speech.start()
            } else { focused = true }
        }
        .onChange(of: speech.transcript) { _, value in
            if !value.isEmpty { tv.draft = prefix + value }
        }
        .onChange(of: scenePhase) { _, phase in
            // Permission prompts make the app inactive; let in-flight permission requests finish.
            if phase == .background || (phase != .active && speech.recording) { speech.stop() }
        }
        .onDisappear { speech.stop() }
    }
    private func beginDictation() {
        focused = false
        prefix = tv.draft.isEmpty ? "" : tv.draft + " "
        Task { await speech.start() }
    }
}

struct MoreControlsSheet: View {
    @EnvironmentObject private var tv: SamsungConnection
    @Environment(\.dismiss) private var dismiss
    private let digits: [(String, RemoteKey)] = [("1", .one),("2", .two),("3", .three),("4", .four),("5", .five),("6", .six),("7", .seven),("8", .eight),("9", .nine)]
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 24) {
                    LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 12), count: 3), spacing: 12) {
                        ForEach(digits, id: \.0) { entry in control(entry.0, entry.1) }
                        control("Guide", .guide); control("0", .zero); control("Info", .info)
                    }
                    HStack(spacing: 12) { control("Channel down", .channelDown); control("Channel up", .channelUp) }
                    HStack(spacing: 12) { control("Menu", .menu); control("Exit", .exit); control("Stop", .stop) }
                    LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
                        control("Red", .red); control("Green", .green); control("Yellow", .yellow); control("Blue", .blue)
                    }
                    Text("Channel and colored controls depend on the active TV app or input.").font(.footnote).foregroundStyle(.secondary)
                }.disabled(!tv.isConnected).padding(24).frame(maxWidth: 520).frame(maxWidth: .infinity)
                if !tv.isConnected { Text("Reconnect from the remote screen to use these controls.").padding() }
                if let notice = tv.notice { Text(notice).font(.callout).padding() }
            }.background(Palette.background).navigationTitle("More controls").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } } }
        }
    }
    private func control(_ label: String, _ key: RemoteKey) -> some View {
        Button(label) { Task { await tv.key(key) } }.buttonStyle(RemoteButtonStyle())
    }
}

struct AppsSheet: View {
    @EnvironmentObject private var store: LibraryStore
    @EnvironmentObject private var tv: SamsungConnection
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        NavigationStack {
            List {
                Section("Saved shortcuts") {
                    if let profile = store.selected, !profile.shortcuts.isEmpty {
                        ForEach(profile.shortcuts) { shortcut in
                            Button { Task { await tv.launch(shortcut) } } label: {
                                Label(shortcut.name, systemImage: "play.rectangle").frame(minHeight: 48)
                            }.disabled(!tv.isConnected)
                        }
                    } else {
                        Text("Save apps from the TV’s list below, or add an app ID in Settings.").foregroundStyle(.secondary)
                    }
                }
                Section("Apps reported by TV") {
                    Button { Task { await tv.fetchApps() } } label: {
                        HStack { if tv.loadingApps { ProgressView() }; Text(tv.loadingApps ? "Looking for apps" : "Get apps from TV").frame(minHeight: 48) }
                    }.disabled(!tv.isConnected || tv.loadingApps)
                    ForEach(tv.installedApps) { app in
                        HStack {
                            Button(app.name) { Task { await tv.launch(app) } }.frame(minHeight: 48).disabled(!tv.isConnected)
                            Spacer()
                            let saved = store.selected?.shortcuts.contains { $0.appID == app.appID } == true
                            Button(saved ? "Saved" : "Save") {
                                if var profile = store.selected, !saved { profile.shortcuts.append(app); _ = store.save(profile) }
                            }.buttonStyle(.bordered).frame(minHeight: 48).disabled(saved)
                                .accessibilityLabel(saved ? "\(app.name) saved" : "Save \(app.name) shortcut")
                        }
                    }
                    Text("Some Samsung firmware versions do not return an app list.").font(.footnote).foregroundStyle(.secondary)
                }
                if let notice = tv.notice { Section { Text(notice).font(.callout) } }
                if !tv.isConnected { Section { Text("Reconnect from the remote screen to launch apps.") } }
            }.navigationTitle("TV apps").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } } }
        }
    }
}
