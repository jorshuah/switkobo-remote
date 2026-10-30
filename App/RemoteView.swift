import SwiftUI
import RemoteCore

enum Palette {
    static let background = Color(uiColor: UIColor { $0.userInterfaceStyle == .dark ? UIColor(red: 0.067, green: 0.09, blue: 0.082, alpha: 1) : UIColor(red: 0.95, green: 0.96, blue: 0.94, alpha: 1) })
    static let surface = Color(uiColor: UIColor { $0.userInterfaceStyle == .dark ? UIColor(red: 0.133, green: 0.176, blue: 0.153, alpha: 1) : .white })
    static let accent = Color(uiColor: UIColor { $0.userInterfaceStyle == .dark ? UIColor(red: 0.737, green: 0.91, blue: 0.796, alpha: 1) : UIColor(red: 0.16, green: 0.36, blue: 0.24, alpha: 1) })
}

struct RemoteButtonStyle: ButtonStyle {
    var primary = false
    @Environment(\.isEnabled) private var enabled
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.headline)
            .frame(maxWidth: .infinity, minHeight: 52)
            .padding(.horizontal, 8)
            .foregroundStyle(primary ? Palette.background : Color.primary)
            .background(primary ? Palette.accent : Palette.surface, in: RoundedRectangle(cornerRadius: 18))
            .opacity(!enabled ? 0.4 : (configuration.isPressed ? 0.65 : 1))
    }
}

enum RemoteSheet: String, Identifiable { case addTV, keyboard, voice, more, apps; var id: String { rawValue } }

struct RemoteView: View {
    @EnvironmentObject private var store: LibraryStore
    @EnvironmentObject private var tv: SamsungConnection
    @State private var sheet: RemoteSheet?
    @State private var touchpad = false
    @State private var powerConfirmation = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 24) {
                    if store.selected != nil { deviceHeader }
                    connectionFeedback
                    if store.selected != nil {
                        controls.disabled(!tv.isConnected)
                        if !tv.isConnected, let profile = store.selected, !profile.mac.isEmpty {
                            Button(tv.waking ? "Sending wake request" : "Wake TV") { tv.wake(profile) }
                                .buttonStyle(RemoteButtonStyle()).disabled(tv.waking || tv.isConnecting)
                        }
                    } else {
                        VStack(spacing: 16) {
                            Image(systemName: "appletvremote.gen4").font(.system(size: 64)).foregroundStyle(Palette.accent).accessibilityHidden(true)
                            Text("Connect your Samsung TV").font(.title2.bold())
                            Text("Connect your Samsung TV once, then control it directly from your iPhone.")
                                .foregroundStyle(.secondary).multilineTextAlignment(.center)
                            Button("Connect a TV") { sheet = .addTV }.buttonStyle(RemoteButtonStyle(primary: true))
                            Text("Keep your iPhone and TV on the same Wi-Fi network. You’ll approve the first connection on the TV.")
                                .font(.footnote).foregroundStyle(.secondary)
                        }.padding(.vertical, 36)
                    }
                    if let notice = tv.notice {
                        HStack(alignment: .top) {
                            Text(notice).font(.callout).frame(maxWidth: .infinity, alignment: .leading)
                            Button { tv.notice = nil } label: { Image(systemName: "xmark").frame(width: 48, height: 48) }
                                .accessibilityLabel("Dismiss message")
                        }.padding(16).background(Palette.surface, in: RoundedRectangle(cornerRadius: 18))
                            .accessibilityElement(children: .contain)
                    }
                }.padding(24).frame(maxWidth: 520).frame(maxWidth: .infinity)
            }
            .background(Palette.background)
            .navigationTitle("Remote")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    NavigationLink { SettingsView() } label: { Image(systemName: "gearshape").frame(width: 48, height: 48) }
                        .accessibilityLabel("Remote settings")
                }
            }
            .sheet(item: $sheet) { item in
                switch item {
                case .addTV: TVEditor(profile: TVProfile())
                case .keyboard: KeyboardSheet(startDictation: false)
                case .voice: KeyboardSheet(startDictation: true)
                case .more: MoreControlsSheet()
                case .apps: AppsSheet()
                }
            }
            .confirmationDialog("Turn off the TV?", isPresented: $powerConfirmation, titleVisibility: .visible) {
                Button("Turn off TV", role: .destructive) { send(.powerOff) }
                Button("Cancel", role: .cancel) {}
            } message: { Text("Turning it back on over Wi-Fi depends on the TV’s standby settings.") }
        }
    }

    private var deviceHeader: some View {
        HStack(alignment: .center, spacing: 12) {
            VStack(alignment: .leading, spacing: 8) {
                if let selected = store.selected {
                    Menu {
                        ForEach(store.library.profiles) { profile in
                            Button(profile.name) { if store.select(profile.id) { tv.connect(profile) } }
                        }
                        Button("Add TV", systemImage: "plus") { sheet = .addTV }
                    } label: {
                        Label(selected.name, systemImage: "chevron.down").font(.title2.bold()).multilineTextAlignment(.leading).frame(minHeight: 48)
                    }.accessibilityLabel("Select TV, \(selected.name)")
                    Label(tv.state.label, systemImage: tv.isConnected ? "wifi" : "wifi.slash")
                        .font(.footnote).foregroundStyle(.secondary)
                } else {
                    Text("Welcome home").font(.title2.bold())
                }
            }.frame(maxWidth: .infinity, alignment: .leading)
            if store.selected != nil {
                Button { powerConfirmation = true } label: { Image(systemName: "power").frame(width: 52, height: 52).background(Palette.surface, in: Circle()) }
                    .accessibilityLabel("Turn off TV").disabled(!tv.isConnected)
            }
        }
    }

    @ViewBuilder private var connectionFeedback: some View {
        if tv.isConnecting {
            VStack(spacing: 12) {
                ProgressView()
                Text("Select Allow on your TV").font(.headline)
                Text("If you have already paired, the connection should resume shortly.").font(.callout).foregroundStyle(.secondary)
                Button("Cancel connection") { tv.disconnect() }.frame(minHeight: 48)
            }.frame(maxWidth: .infinity).padding(20).background(Palette.surface, in: RoundedRectangle(cornerRadius: 20))
        } else if !tv.isConnected, let profile = store.selected {
            VStack(alignment: .leading, spacing: 12) {
                if case .failed(let message) = tv.state { Text(message).font(.callout) }
                Button("Connect to TV") { tv.connect(profile) }.buttonStyle(RemoteButtonStyle(primary: true))
            }
        }
    }

    private var controls: some View {
        VStack(spacing: 20) {
            Picker("Navigation mode", selection: $touchpad) {
                Text("Buttons").tag(false); Text("Touchpad").tag(true)
            }.pickerStyle(.segmented)
            if touchpad {
                VStack(spacing: 16) {
                    Image(systemName: "hand.draw").font(.largeTitle).accessibilityHidden(true)
                    Text("Swipe to navigate").font(.headline)
                    Text("Tap to select").foregroundStyle(.secondary)
                }.frame(maxWidth: .infinity).frame(height: 240)
                    .background(Palette.surface, in: RoundedRectangle(cornerRadius: 32))
                    .contentShape(Rectangle())
                    .gesture(DragGesture(minimumDistance: 0).onEnded { value in
                        let x = value.translation.width, y = value.translation.height
                        if max(abs(x), abs(y)) < 18 { send(.select) }
                        else if abs(x) > abs(y) { send(x > 0 ? .right : .left) }
                        else { send(y > 0 ? .down : .up) }
                    })
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel("TV touchpad")
                    .accessibilityHint("Use actions to navigate, or choose Buttons above")
                    .accessibilityAction(named: "Move up") { send(.up) }
                    .accessibilityAction(named: "Move down") { send(.down) }
                    .accessibilityAction(named: "Move left") { send(.left) }
                    .accessibilityAction(named: "Move right") { send(.right) }
                    .accessibilityAction(named: "Select") { send(.select) }
            } else {
                Grid(horizontalSpacing: 12, verticalSpacing: 12) {
                    GridRow { Color.clear.gridCellUnsizedAxes([.horizontal, .vertical]); keyButton("Up", "chevron.up", .up); Color.clear.gridCellUnsizedAxes([.horizontal, .vertical]) }
                    GridRow { keyButton("Left", "chevron.left", .left); Button("Select") { send(.select) }.buttonStyle(RemoteButtonStyle(primary: true)); keyButton("Right", "chevron.right", .right) }
                    GridRow { Color.clear.gridCellUnsizedAxes([.horizontal, .vertical]); keyButton("Down", "chevron.down", .down); Color.clear.gridCellUnsizedAxes([.horizontal, .vertical]) }
                }.padding(20).frame(minHeight: 240).background(Palette.surface.opacity(0.5), in: RoundedRectangle(cornerRadius: 32))
            }
            HStack(spacing: 12) { keyButton("Back", "arrow.uturn.backward", .back); keyButton("Home", "house", .home); keyButton("Inputs", "rectangle.on.rectangle", .source) }
            HStack(spacing: 12) { keyButton("Volume down", "speaker.minus", .volumeDown); keyButton("Mute", "speaker.slash", .mute); keyButton("Volume up", "speaker.plus", .volumeUp) }
            HStack(spacing: 12) { keyButton("Rewind", "backward.fill", .rewind); keyButton("Play", "play.fill", .play); keyButton("Pause", "pause.fill", .pause); keyButton("Forward", "forward.fill", .forward) }
            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
                tool("Keyboard", "keyboard", .keyboard)
                tool("Dictate", "mic", .voice)
                tool("Apps", "square.grid.2x2", .apps)
                tool("More controls", "slider.horizontal.3", .more)
            }
        }
    }
    private func keyButton(_ title: String, _ symbol: String, _ key: RemoteKey) -> some View {
        Button { send(key) } label: { Image(systemName: symbol).font(.title3).frame(minHeight: 12) }
            .buttonStyle(RemoteButtonStyle()).accessibilityLabel(title)
    }
    private func tool(_ title: String, _ symbol: String, _ target: RemoteSheet) -> some View {
        Button { sheet = target } label: { Label(title, systemImage: symbol).font(.callout).padding(.vertical, 8) }
            .buttonStyle(RemoteButtonStyle())
    }
    private func send(_ key: RemoteKey) {
        if store.library.haptics { UISelectionFeedbackGenerator().selectionChanged() }
        Task { await tv.key(key) }
    }
}
