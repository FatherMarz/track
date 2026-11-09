import AppKit
import WebKit

// A small native window around My day. The board remains the source of truth.
final class StickyPanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { true }
}

final class StickyApp: NSObject, NSApplicationDelegate, WKScriptMessageHandler, WKUIDelegate, WKNavigationDelegate {
    var panel: StickyPanel!
    var status: NSStatusItem!
    var pinItem: NSMenuItem!
    var web: WKWebView!
    var pinned = UserDefaults.standard.object(forKey: "pinned") as? Bool ?? true

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        installEditingMenu()
        let content = WKUserContentController()
        content.add(self, name: "trackSticky")
        let config = WKWebViewConfiguration()
        config.userContentController = content
        web = WKWebView(frame: .zero, configuration: config)
        web.uiDelegate = self
        web.navigationDelegate = self
        web.setValue(false, forKey: "drawsBackground")
        panel = StickyPanel(contentRect: NSRect(x: 0, y: 0, width: 320, height: 360), styleMask: [.titled, .closable, .resizable, .miniaturizable], backing: .buffered, defer: false)
        panel.title = "Track · My day"
        panel.isReleasedWhenClosed = false
        panel.hidesOnDeactivate = false
        panel.isFloatingPanel = true
        panel.minSize = NSSize(width: 280, height: 220)
        panel.backgroundColor = NSColor(calibratedRed: 0.059, green: 0.059, blue: 0.067, alpha: 1)
        panel.contentView = web
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        panel.setFrameAutosaveName("TrackMyDay")
        if !panel.setFrameUsingName("TrackMyDay") { panel.center() }
        if !UserDefaults.standard.bool(forKey: "compactLayoutV1") {
            panel.setContentSize(NSSize(width: 320, height: 360))
            UserDefaults.standard.set(true, forKey: "compactLayoutV1")
        }
        status = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        status.button?.image = NSImage(systemSymbolName: "checklist", accessibilityDescription: "Track My day")
        let menu = NSMenu()
        let show = NSMenuItem(title: "Show My day", action: #selector(showWindow), keyEquivalent: "")
        show.target = self; menu.addItem(show)
        pinItem = NSMenuItem(title: "Always on top", action: #selector(togglePin), keyEquivalent: "")
        pinItem.target = self; menu.addItem(pinItem)
        let full = NSMenuItem(title: "Open full Track", action: #selector(openTrack), keyEquivalent: "")
        full.target = self; menu.addItem(full)
        menu.addItem(.separator())
        let quit = NSMenuItem(title: "Quit Track", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        menu.addItem(quit); status.menu = menu
        updatePin()
        web.load(URLRequest(url: URL(string: "http://127.0.0.1:4747/?sticky=1#/mine")!))
        showPinnedNote()
    }

    private func installEditingMenu() {
        // WKWebView uses the macOS responder chain for Command shortcuts.
        let main = NSMenu()
        let appItem = NSMenuItem(); main.addItem(appItem)
        let appMenu = NSMenu(title: "Track")
        appMenu.addItem(withTitle: "Quit Track", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu
        let editItem = NSMenuItem(); main.addItem(editItem)
        let edit = NSMenu(title: "Edit")
        edit.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
        let redo = edit.addItem(withTitle: "Redo", action: Selector(("redo:")), keyEquivalent: "z")
        redo.keyEquivalentModifierMask = [.command, .shift]
        edit.addItem(.separator())
        for (title, action, key) in [("Cut", "cut:", "x"), ("Copy", "copy:", "c"), ("Paste", "paste:", "v"), ("Select All", "selectAll:", "a")] {
            edit.addItem(withTitle: title, action: Selector(action), keyEquivalent: key)
        }
        editItem.submenu = edit
        NSApp.mainMenu = main
    }

    @objc func showWindow() {
        NSApp.activate(ignoringOtherApps: true)
        if panel.isMiniaturized { panel.deminiaturize(nil) }
        panel.makeKeyAndOrderFront(nil)
    }

    private func showPinnedNote() {
        pinned = true
        UserDefaults.standard.set(true, forKey: "pinned")
        updatePin()
        showWindow()
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        showPinnedNote()
        return false
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }

    func application(_ application: NSApplication, open urls: [URL]) {
        if urls.contains(where: { $0.scheme == "track-sticky" && $0.host == "open" }) {
            if panel != nil { showPinnedNote() }
        }
    }

    @objc func openTrack() { NSWorkspace.shared.open(URL(string: "http://127.0.0.1:4747/?full=1#/")!) }

    @objc func togglePin() { pinned.toggle(); UserDefaults.standard.set(pinned, forKey: "pinned"); updatePin() }

    func updatePin() {
        panel.level = pinned ? .floating : .normal
        pinItem.state = pinned ? .on : .off
        web.evaluateJavaScript("(() => { window.trackStickyPinned = \(pinned); const b = document.querySelector('[data-personal=pin]'); if (b) { b.setAttribute('aria-pressed', '\(pinned)'); b.textContent = '\(pinned ? "Pinned ↟" : "Pin ↟")'; } })()", completionHandler: nil)
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame, message.frameInfo.securityOrigin.host == "127.0.0.1", message.frameInfo.securityOrigin.port == 4747,
              let body = message.body as? [String: String], body["action"] == "togglePin" else { return }
        togglePin()
    }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url, url.scheme == "http", url.host == "127.0.0.1", url.port == 4747 else { decisionHandler(.cancel); return }
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = action.request.url, url.scheme == "http", url.host == "127.0.0.1", url.port == 4747 { NSWorkspace.shared.open(url) }
        return nil
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        updatePin()
        if CommandLine.arguments.contains("--verify") { verifyWindow(attempt: 0) }
    }

    private func verifyWindow(attempt: Int) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) {
            self.web.evaluateJavaScript("({ myDay: !!document.querySelector('.personal-page'), compact: document.documentElement.classList.contains('sticky-mode') })") { result, error in
                let state = result as? [String: Bool] ?? [:]
                guard error == nil, state["myDay"] == true, state["compact"] == true else {
                    if attempt < 30 { self.verifyWindow(attempt: attempt + 1) }
                    else { fputs("Track Sticky could not load My day.\n", stderr); exit(1) }
                    return
                }
                let info: [String: Any] = ["myDay": true, "compact": true, "floating": self.panel.level == .floating,
                    "allSpaces": self.panel.collectionBehavior.contains(.canJoinAllSpaces), "width": self.panel.frame.width]
                if CommandLine.arguments.contains("--verify-dock") {
                    self.verifyDockReopen(info)
                } else if CommandLine.arguments.contains("--verify-shortcuts") {
                    Task { @MainActor in
                        do {
                            let checks = try await self.verifyEditingShortcuts()
                            guard checks.values.allSatisfy({ $0 }) else { print(checks); exit(1) }
                            var checked = info; checked["shortcuts"] = checks
                            self.finishVerification(checked)
                        } catch { fputs("Shortcut check: \(error)\n", stderr); exit(1) }
                    }
                } else { self.finishVerification(info) }
            }
        }
    }

    private func verifyDockReopen(_ info: [String: Any]) {
        panel.close()
        pinned = false
        updatePin()
        NSWorkspace.shared.openApplication(at: Bundle.main.bundleURL, configuration: NSWorkspace.OpenConfiguration()) { _, error in
            if let error = error { fputs("Dock reopen: \(error)\n", stderr); exit(1) }
            self.checkDockReopen(info, attempt: 0)
        }
    }

    private func checkDockReopen(_ info: [String: Any], attempt: Int) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
            if self.panel.isVisible && !self.panel.isMiniaturized && self.pinned && self.panel.level == .floating {
                if info["closedWindowRestored"] as? Bool != true {
                    var next = info; next["closedWindowRestored"] = true
                    self.panel.miniaturize(nil)
                    self.pinned = false; self.updatePin()
                    NSWorkspace.shared.openApplication(at: Bundle.main.bundleURL, configuration: NSWorkspace.OpenConfiguration()) { _, error in
                        if let error = error { fputs("Dock unminimize: \(error)\n", stderr); exit(1) }
                        self.checkDockReopen(next, attempt: 0)
                    }
                    return
                }
                self.web.evaluateJavaScript("document.querySelector('[data-personal=pin]')?.getAttribute('aria-pressed') === 'true'") { value, _ in
                    guard value as? Bool == true else { fputs("Pin control did not reflect pinned state.\n", stderr); exit(1) }
                    var result = info
                    result["dockReopen"] = true
                    result["minimizedWindowRestored"] = true
                    result["pinControl"] = true
                    result["regularDockApp"] = NSApp.activationPolicy() == .regular
                    self.finishVerification(result)
                }
            } else if attempt < 30 { self.checkDockReopen(info, attempt: attempt + 1) }
            else { fputs("Dock reopen did not restore the pinned note.\n", stderr); exit(1) }
        }
    }

    private func finishVerification(_ info: [String: Any]) {
        if let json = try? JSONSerialization.data(withJSONObject: info, options: [.sortedKeys]), let text = String(data: json, encoding: .utf8) { print(text) }
        web.takeSnapshot(with: nil) { image, _ in
                    if let image = image, let tiff = image.tiffRepresentation, let bitmap = NSBitmapImageRep(data: tiff),
                       let png = bitmap.representation(using: .png, properties: [:]) {
                        try? png.write(to: URL(fileURLWithPath: "/private/tmp/track-sticky-native.png"))
                    }
                    NSApp.terminate(nil)
        }
    }

    @MainActor private func verifyEditingShortcuts() async throws -> [String: Bool] {
        let clipboard = NSPasteboard.general
        let original = (clipboard.pasteboardItems ?? []).map { item -> NSPasteboardItem in
            let copy = NSPasteboardItem()
            for type in item.types { if let data = item.data(forType: type) { copy.setData(data, forType: type) } }
            return copy
        }
        var ourClipboardChange: Int?
        let sample = "Track keyboard check " + UUID().uuidString
        defer {
            // Preserve the user's clipboard. Do not replace a newer copy from another app.
            if let change = ourClipboardChange, clipboard.changeCount == change || clipboard.string(forType: .string) == sample {
                clipboard.clearContents(); clipboard.writeObjects(original)
            }
            web.evaluateJavaScript("document.getElementById('track-shortcut-check')?.remove()", completionHandler: nil)
        }
        panel.makeKeyAndOrderFront(nil); panel.makeFirstResponder(web)
        _ = try await web.evaluateJavaScript("""
        (() => { const input = document.createElement('textarea'); input.id = 'track-shortcut-check';
        input.value = '\(sample)'; input.style.cssText = 'position:fixed;top:0;left:0;z-index:99999';
        document.body.appendChild(input); input.focus(); input.setSelectionRange(input.value.length,input.value.length); return true; })()
        """)
        try await Task.sleep(nanoseconds: 150_000_000)
        func press(_ key: String, _ keyCode: UInt16, shift: Bool = false) -> Bool {
            let flags: NSEvent.ModifierFlags = shift ? [.command, .shift] : [.command]
            guard let event = NSEvent.keyEvent(with: .keyDown, location: .zero, modifierFlags: flags,
                timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: panel.windowNumber, context: nil,
                characters: key, charactersIgnoringModifiers: key, isARepeat: false, keyCode: keyCode) else { return false }
            NSApp.sendEvent(event)
            return true
        }
        func matches(_ script: String) async throws -> Bool {
            for _ in 0..<50 {
                if try await web.evaluateJavaScript(script) as? Bool == true { return true }
                try await Task.sleep(nanoseconds: 40_000_000)
            }
            return false
        }
        func copied() async throws -> Bool {
            for _ in 0..<50 {
                if clipboard.string(forType: .string) == sample { return true }
                try await Task.sleep(nanoseconds: 40_000_000)
            }
            return false
        }
        var result: [String: Bool] = [:]
        _ = press("a", 0)
        result["selectAll"] = try await matches("(() => {const t=document.getElementById('track-shortcut-check');return t.selectionStart===0 && t.selectionEnd===t.value.length;})()")
        guard result["selectAll"] == true else { return result }
        _ = press("c", 8)
        result["copy"] = try await copied(); ourClipboardChange = clipboard.changeCount
        guard result["copy"] == true else { return result }
        _ = press("x", 7)
        result["cut"] = try await matches("document.getElementById('track-shortcut-check').value === ''")
        _ = try await copied(); ourClipboardChange = clipboard.changeCount
        guard result["cut"] == true else { return result }
        _ = press("v", 9)
        result["paste"] = try await matches("document.getElementById('track-shortcut-check').value === '\(sample)'")
        guard result["paste"] == true else { return result }
        // A distinct edit makes Undo observable even when AppKit groups cut/paste.
        _ = try await web.evaluateJavaScript("(() => {const t=document.getElementById('track-shortcut-check');t.setSelectionRange(t.value.length,t.value.length);return document.execCommand('insertText',false,'!');})()")
        _ = press("z", 6)
        result["undo"] = try await matches("document.getElementById('track-shortcut-check').value !== '\(sample)!'")
        guard result["undo"] == true else { return result }
        _ = press("z", 6, shift: true)
        result["redo"] = try await matches("document.getElementById('track-shortcut-check').value === '\(sample)!'")
        return result
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        if CommandLine.arguments.contains("--verify") { fputs("Track Sticky: \(error.localizedDescription)\n", stderr); exit(1) }
        let alert = NSAlert()
        alert.messageText = "Track is not running"
        alert.informativeText = "Start the Track server on this Mac, then reopen My day from the menu bar."
        alert.addButton(withTitle: "Retry")
        alert.addButton(withTitle: "Close")
        if alert.runModal() == .alertFirstButtonReturn { webView.reload() }
    }
}

let app = NSApplication.shared
let delegate = StickyApp()
app.delegate = delegate
app.run()
