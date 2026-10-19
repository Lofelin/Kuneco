import AppKit

// Render the existing brand artwork inside a transparent macOS icon canvas.
// This is a build tool, not part of the desktop runtime.
let source = URL(fileURLWithPath: CommandLine.arguments[1])
let output = URL(fileURLWithPath: CommandLine.arguments[2], isDirectory: true)
guard let artwork = NSImage(contentsOf: source) else { fatalError("Cannot read brand artwork") }
try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)

func render(_ pixels: Int, _ destination: URL) throws {
    let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: pixels, pixelsHigh: pixels,
        bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
        colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
    let scale = CGFloat(pixels) / 1024
    let transform = NSAffineTransform()
    transform.scale(by: scale)
    transform.concat()
    NSGraphicsContext.current?.imageInterpolation = .high
    // Insets keep the icon at the same optical size as neighboring Dock apps.
    let tile = NSRect(x: 100, y: 100, width: 824, height: 824)
    NSBezierPath(roundedRect: tile, xRadius: 185, yRadius: 185).addClip()
    NSColor.white.setFill()
    tile.fill()
    artwork.draw(in: tile, from: .zero, operation: .sourceOver, fraction: 1)
    NSGraphicsContext.restoreGraphicsState()
    try bitmap.representation(using: .png, properties: [:])!.write(to: destination)
}

for size in [16, 32, 128, 256, 512] {
    try render(size, output.appendingPathComponent("icon_\(size)x\(size).png"))
    try render(size * 2, output.appendingPathComponent("icon_\(size)x\(size)@2x.png"))
}
