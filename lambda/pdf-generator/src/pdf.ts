import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import type { StoredRecommendation } from './types'

const PAGE_WIDTH = 595
const PAGE_HEIGHT = 842
const MARGIN = 50
const INK = rgb(0.169, 0.169, 0.157) // matches the app's #2B2B28
const PLATE = rgb(0.149, 0.141, 0.122) // matches the app's #26241F
const MUTED = rgb(0.5, 0.5, 0.48)

export async function generateReportPdf(
    periodStart: string,
    recommendation: StoredRecommendation
): Promise<Uint8Array> {
    const doc = await PDFDocument.create()
    const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT])
    const bold = await doc.embedFont(StandardFonts.HelveticaBold)
    const regular = await doc.embedFont(StandardFonts.Helvetica)

    let y = PAGE_HEIGHT - MARGIN

    y = drawHeading(page, bold, 'GymPro Training Report', y)
    y = drawText(page, regular, `Period starting ${periodStart}`, y - 4, MUTED, 11)
    y -= 20

    y = drawSectionTitle(page, bold, 'Summary', y)
    y = drawParagraph(page, regular, recommendation.summary, y, 10)
    y -= 16

    const strengthEntries = Object.entries(recommendation.strengthIndex)
    if (strengthEntries.length > 0) {
        y = drawSectionTitle(page, bold, 'Strength Index', y)
        for (const [muscle, data] of strengthEntries) {
            const change =
                data.previousIndex !== null ? data.currentIndex - data.previousIndex : null
            const changeLabel = change !== null ? ` (${change >= 0 ? '+' : ''}${change})` : ''
            y = drawText(
                page,
                regular,
                `${capitalize(muscle)}: ${data.currentIndex}${changeLabel}`,
                y,
                INK,
                10
            )
        }
        y -= 16
    }

    const splitEntries = Object.entries(recommendation.volumeSplit)
    if (splitEntries.length > 0) {
        y = drawSectionTitle(page, bold, 'Training Split', y)
        for (const [muscle, pct] of splitEntries) {
            y = drawBar(page, regular, muscle, pct, y)
        }
        y -= 16
    }

    y = drawSectionTitle(page, bold, 'Progressive Overload', y)
    y = drawParagraph(page, regular, recommendation.progressiveOverload.notes, y, 10)
    y -= 16

    if (recommendation.muscleImbalances.length > 0) {
        y = drawSectionTitle(page, bold, 'Things to Watch', y)
        for (const item of recommendation.muscleImbalances) {
            y = drawParagraph(
                page,
                regular,
                `${capitalize(item.muscleGroup)} (${item.severity}): ${item.observation}`,
                y,
                10
            )
        }
        y -= 16
    }

    if (recommendation.deloadRecommended && recommendation.deloadReason) {
        y = drawSectionTitle(page, bold, 'Deload Recommended', y)
        y = drawParagraph(page, regular, recommendation.deloadReason, y, 10)
        y -= 16
    }

    y = drawSectionTitle(page, bold, 'What To Do Next', y)
    for (const item of recommendation.actionItems) {
        y = drawParagraph(page, regular, `• ${item}`, y, 10)
    }

    return doc.save()
}

function drawHeading(page: PDFPage, font: PDFFont, text: string, y: number): number {
    page.drawText(text, { x: MARGIN, y, size: 20, font, color: PLATE })
    return y - 24
}

function drawSectionTitle(page: PDFPage, font: PDFFont, text: string, y: number): number {
    page.drawText(text.toUpperCase(), { x: MARGIN, y, size: 11, font, color: MUTED })
    return y - 18
}

function drawText(
    page: PDFPage,
    font: PDFFont,
    text: string,
    y: number,
    color = INK,
    size = 10
): number {
    page.drawText(text, { x: MARGIN, y, size, font, color })
    return y - (size + 6)
}

// pdf-lib has no built-in text wrapping — this measures each word against
// the font metrics and breaks lines manually to fit the page width.
function drawParagraph(
    page: PDFPage,
    font: PDFFont,
    text: string,
    y: number,
    size: number
): number {
    const maxWidth = PAGE_WIDTH - MARGIN * 2
    const words = text.split(' ')
    let line = ''
    let cursorY = y

    for (const word of words) {
        const candidate = line ? `${line} ${word}` : word
        const width = font.widthOfTextAtSize(candidate, size)
        if (width > maxWidth && line) {
            page.drawText(line, { x: MARGIN, y: cursorY, size, font, color: INK })
            cursorY -= size + 4
            line = word
        } else {
            line = candidate
        }
    }
    if (line) {
        page.drawText(line, { x: MARGIN, y: cursorY, size, font, color: INK })
        cursorY -= size + 4
    }

    return cursorY - 4
}

function drawBar(page: PDFPage, font: PDFFont, label: string, pct: number, y: number): number {
    const barMaxWidth = 200
    const barWidth = Math.max(2, (pct / 100) * barMaxWidth)
    const labelText = `${capitalize(label)} — ${pct}%`

    page.drawText(labelText, { x: MARGIN, y, size: 9, font, color: INK })
    page.drawRectangle({
        x: MARGIN,
        y: y - 14,
        width: barMaxWidth,
        height: 6,
        color: rgb(0.9, 0.9, 0.88),
    })
    page.drawRectangle({
        x: MARGIN,
        y: y - 14,
        width: barWidth,
        height: 6,
        color: PLATE,
    })

    return y - 26
}

function capitalize(text: string): string {
    return text.charAt(0).toUpperCase() + text.slice(1)
}