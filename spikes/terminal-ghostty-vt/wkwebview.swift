// Opens the benchmark page in a plain WKWebView window, the engine a Tauri
// window uses on macOS, waits for the page to finish and saves a snapshot.
import AppKit
import WebKit

let args = CommandLine.arguments
if args.count < 3 || URL(string: args[1]) == nil {
    print("Usage: wkwebview <url> <snapshot.png>")
    exit(2)
}
let pageURL = URL(string: args[1])!
let snapshotPath = args[2]

final class Driver: NSObject, NSApplicationDelegate {
    var window: NSWindow!
    var web: WKWebView!

    func applicationDidFinishLaunching(_ note: Notification) {
        let frame = NSRect(x: 40, y: 40, width: 1680, height: 1050)
        window = NSWindow(contentRect: frame, styleMask: [.titled, .closable], backing: .buffered, defer: false)
        window.title = "terax ghostty-vt spike"
        web = WKWebView(frame: frame, configuration: WKWebViewConfiguration())
        window.contentView = web
        window.orderFrontRegardless()
        web.load(URLRequest(url: pageURL))
        Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { _ in self.poll() }
    }

    func poll() {
        web.evaluateJavaScript("window.__done === true") { value, _ in
            guard (value as? Bool) == true else { return }
            self.web.takeSnapshot(with: nil) { image, _ in
                if let tiff = image?.tiffRepresentation,
                   let png = NSBitmapImageRep(data: tiff)?.representation(using: .png, properties: [:]) {
                    try? png.write(to: URL(fileURLWithPath: snapshotPath))
                }
                NSApp.terminate(nil)
            }
        }
    }
}

let app = NSApplication.shared
let driver = Driver()
app.delegate = driver
app.setActivationPolicy(.accessory)
app.run()
