import Foundation
import Vision
import ImageIO

if CommandLine.arguments.count < 2 {
    fputs("Usage: ocr_image.swift <image-path>\n", stderr)
    exit(1)
}

let imagePath = CommandLine.arguments[1]
let imageURL = URL(fileURLWithPath: imagePath)

guard CGImageSourceCreateWithURL(imageURL as CFURL, nil) != nil else {
    fputs("Could not open image: \(imagePath)\n", stderr)
    exit(1)
}

let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.usesLanguageCorrection = false
request.recognitionLanguages = ["en-US"]
if #available(macOS 13.0, *) {
    request.revision = VNRecognizeTextRequestRevision3
}

let handler = VNImageRequestHandler(url: imageURL, options: [:])
do {
    try handler.perform([request])
    let observations = request.results ?? []
    for observation in observations {
        if let candidate = observation.topCandidates(1).first {
            print(candidate.string)
        }
    }
} catch {
    fputs("OCR failed: \(error)\n", stderr)
    exit(1)
}
