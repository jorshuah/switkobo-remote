import AVFoundation
import Speech
import Foundation
import Combine

@MainActor
final class Dictation: ObservableObject {
    @Published private(set) var recording = false
    @Published private(set) var starting = false
    @Published private(set) var transcript = ""
    @Published var error: String?
    private let engine = AVAudioEngine()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var recognition: SFSpeechRecognitionTask?
    private var timer: Task<Void, Never>?
    private var generation = UUID()
    private var hasTap = false

    func start() async {
        guard !recording, !starting, !Task.isCancelled else { return }
        stop(); error = nil; transcript = ""; starting = true
        let current = generation
        let speech = await withCheckedContinuation { continuation in
            SFSpeechRecognizer.requestAuthorization { continuation.resume(returning: $0) }
        }
        guard generation == current, !Task.isCancelled else { return }
        guard speech == .authorized else {
            error = "Allow Speech Recognition in iPhone Settings to dictate, or use the keyboard."; starting = false; return
        }
        let mic = await withCheckedContinuation { continuation in
            AVAudioApplication.requestRecordPermission { continuation.resume(returning: $0) }
        }
        guard generation == current, !Task.isCancelled else { return }
        guard mic else { error = "Allow Microphone access in iPhone Settings to dictate."; starting = false; return }
        guard let recognizer = SFSpeechRecognizer(locale: .current), recognizer.isAvailable,
              recognizer.supportsOnDeviceRecognition else {
            error = "On-device dictation is unavailable for this iPhone or language. You can still type your search."; starting = false; return
        }
        do {
            let audio = AVAudioSession.sharedInstance()
            try audio.setCategory(.record, mode: .measurement, options: [.duckOthers])
            try audio.setActive(true)
            let request = SFSpeechAudioBufferRecognitionRequest()
            request.requiresOnDeviceRecognition = true
            request.shouldReportPartialResults = true
            request.taskHint = .search
            self.request = request
            let input = engine.inputNode
            let format = input.outputFormat(forBus: 0)
            guard format.sampleRate > 0, format.channelCount > 0 else { throw CocoaError(.featureUnsupported) }
            input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in request.append(buffer) }
            hasTap = true
            recognition = recognizer.recognitionTask(with: request) { [weak self] result, failure in
                Task { @MainActor in
                    guard let self, self.generation == current else { return }
                    if let result { self.transcript = result.bestTranscription.formattedString }
                    if failure != nil || result?.isFinal == true {
                        if failure != nil && self.transcript.isEmpty { self.error = "Dictation stopped without text. Try again or use the keyboard." }
                        self.stop()
                    }
                }
            }
            engine.prepare(); try engine.start()
            recording = true; starting = false
            timer = Task { [weak self] in
                do { try await Task.sleep(for: .seconds(45)) } catch { return }
                guard let self, self.generation == current else { return }
                self.stop()
            }
        } catch {
            stop(); self.error = "Could not start the microphone. Check permissions and try again."
        }
    }
    func stop() {
        generation = UUID()
        timer?.cancel(); timer = nil
        engine.stop()
        if hasTap { engine.inputNode.removeTap(onBus: 0); hasTap = false }
        request?.endAudio(); request = nil
        recognition?.cancel(); recognition = nil
        recording = false; starting = false
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
}
