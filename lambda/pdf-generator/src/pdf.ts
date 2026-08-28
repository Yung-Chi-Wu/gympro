import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import type { StoredRecommendation } from './types'

const PAGE_WIDTH = 595
const PAGE_HEIGHT = 842
const MARGIN = 50
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2

// Brand colors
const INK = rgb(0.102, 0.094, 0.078)  // #1A1814
const PLATE = rgb(0.149, 0.141, 0.122)  // #26241F
const GOLD = rgb(0.784, 0.584, 0.353)  // #C8955A
const MUTED = rgb(0.502, 0.498, 0.478)  // #807C79
const LIGHT_BG = rgb(0.980, 0.980, 0.973)  // #FAFAF8
const WHITE = rgb(1, 1, 1)

export async function generateReportPdf(
    periodStart: string,
    recommendation: StoredRecommendation
): Promise<Uint8Array> {
    const doc = await PDFDocument.create()
    const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT])
    const bold = await doc.embedFont(StandardFonts.HelveticaBold)
    const regular = await doc.embedFont(StandardFonts.Helvetica)

    let y = PAGE_HEIGHT

    // ── Header bar ──
    page.drawRectangle({ x: 0, y: PAGE_HEIGHT - 72, width: PAGE_WIDTH, height: 72, color: PLATE })

    // GYM (bold white)
    page.drawText('GYM', { x: MARGIN, y: PAGE_HEIGHT - 44, size: 28, font: bold, color: WHITE })
    // PRO (light gold)
    const gymWidth = bold.widthOfTextAtSize('GYM', 28)
    page.drawText('PRO', { x: MARGIN + gymWidth + 2, y: PAGE_HEIGHT - 44, size: 28, font: regular, color: GOLD })

    // Tagline
    page.drawText('AI TRAINING REPORT', { x: MARGIN, y: PAGE_HEIGHT - 60, size: 8, font: regular, color: GOLD })

    // Period date (right side)
    const periodLabel = `Period: ${periodStart}`
    const periodWidth = regular.widthOfTextAtSize(periodLabel, 9)
    page.drawText(periodLabel, {
        x: PAGE_WIDTH - MARGIN - periodWidth,
        y: PAGE_HEIGHT - 44,
        size: 9, font: regular, color: WHITE,
    })

    // Gold accent line under header
    page.drawRectangle({ x: 0, y: PAGE_HEIGHT - 74, width: PAGE_WIDTH, height: 2, color: GOLD })

    y = PAGE_HEIGHT - 72 - 24

    // ── Headline ──
    if (recommendation.headline) {
        y = drawWrappedText(page, bold, recommendation.headline, y, 13, INK)
        y -= 8
        // Thin divider
        page.drawRectangle({ x: MARGIN, y, width: CONTENT_WIDTH, height: 0.5, color: GOLD })
        y -= 16
    }

    // ── Summary ──
    y = drawSection(page, bold, regular, 'SUMMARY', recommendation.summary, y)

    // ── Strength Index ──
    const strengthEntries = Object.entries(recommendation.strengthIndex ?? {})
    if (strengthEntries.length > 0) {
        y = drawSectionHeader(page, bold, 'STRENGTH INDEX', y)
        for (const [muscle, data] of strengthEntries) {
            const change = data.previousIndex !== null
                ? data.currentIndex - data.previousIndex
                : null
            const changeLabel = change !== null
                ? ` (${change >= 0 ? '+' : ''}${change})`
                : ''
            const label = `${capitalize(muscle)}: ${data.currentIndex}${changeLabel}`
            const changeColor = change === null ? MUTED : change >= 0 ? GOLD : rgb(0.8, 0.3, 0.3)
            page.drawText(`• ${capitalize(muscle)}`, { x: MARGIN, y, size: 10, font: bold, color: INK })
            const bulletEnd = MARGIN + bold.widthOfTextAtSize(`• ${capitalize(muscle)}`, 10)
            page.drawText(`  ${data.currentIndex}${changeLabel}`, {
                x: bulletEnd, y, size: 10, font: regular,
                color: change !== null ? changeColor : MUTED,
            })
            y -= 16
        }
        y -= 8
    }

    // ── Training Split ──
    const splitEntries = Object.entries(recommendation.volumeSplit ?? {})
    if (splitEntries.length > 0) {
        y = drawSectionHeader(page, bold, 'TRAINING SPLIT', y)
        for (const [muscle, pct] of splitEntries) {
            y = drawBar(page, regular, bold, muscle, pct, y)
        }
        y -= 8
    }

    // ── Progressive Overload ──
    if (recommendation.progressiveOverload?.notes) {
        y = drawSection(page, bold, regular, 'PROGRESSIVE OVERLOAD', recommendation.progressiveOverload.notes, y)
    }

    // ── Muscle Imbalances ──
    if (recommendation.muscleImbalances?.length > 0) {
        y = drawSectionHeader(page, bold, 'THINGS TO WATCH', y)
        for (const item of recommendation.muscleImbalances) {
            const severityColor =
                item.severity === 'severe' ? rgb(0.8, 0.2, 0.2) :
                    item.severity === 'moderate' ? rgb(0.9, 0.5, 0.1) :
                        GOLD
            page.drawText(`▲ ${capitalize(item.muscleGroup)}`, {
                x: MARGIN, y, size: 10, font: bold, color: severityColor,
            })
            y -= 14
            y = drawWrappedText(page, regular, item.observation, y, 9, MUTED)
            y -= 6
        }
        y -= 4
    }

    // ── Deload ──
    if (recommendation.deloadRecommended && recommendation.deloadReason) {
        // Red banner
        page.drawRectangle({ x: MARGIN, y: y - 2, width: CONTENT_WIDTH, height: 28, color: rgb(0.95, 0.92, 0.92) })
        page.drawRectangle({ x: MARGIN, y: y - 2, width: 3, height: 28, color: rgb(0.8, 0.2, 0.2) })
        page.drawText('⚠ DELOAD RECOMMENDED', {
            x: MARGIN + 10, y: y + 8, size: 9, font: bold, color: rgb(0.7, 0.1, 0.1),
        })
        y -= 36
        y = drawWrappedText(page, regular, recommendation.deloadReason, y, 9, MUTED)
        y -= 8
    }

    // ── Action Items ──
    if (recommendation.actionItems?.length > 0) {
        y = drawSectionHeader(page, bold, 'WHAT TO DO NEXT', y)

        // Light background box
        const boxHeight = recommendation.actionItems.length * 20 + 12
        page.drawRectangle({
            x: MARGIN, y: y - boxHeight + 8,
            width: CONTENT_WIDTH, height: boxHeight,
            color: LIGHT_BG,
        })
        page.drawRectangle({ x: MARGIN, y: y - boxHeight + 8, width: 3, height: boxHeight, color: GOLD })

        for (let i = 0; i < recommendation.actionItems.length; i++) {
            const item = recommendation.actionItems[i]
            page.drawText(`${i + 1}.`, { x: MARGIN + 10, y, size: 10, font: bold, color: GOLD })
            y = drawWrappedText(page, regular, item, y, 10, INK, MARGIN + 24)
            y -= 4
        }
        y -= 8
    }

    // ── Footer ──
    page.drawRectangle({ x: 0, y: 0, width: PAGE_WIDTH, height: 28, color: PLATE })
    page.drawText('GYMPRO — AI TRAINING REPORT', {
        x: MARGIN, y: 9, size: 8, font: regular, color: rgb(0.5, 0.48, 0.44),
    })
    const generatedLabel = `Generated ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}`
    const genWidth = regular.widthOfTextAtSize(generatedLabel, 8)
    page.drawText(generatedLabel, {
        x: PAGE_WIDTH - MARGIN - genWidth, y: 9, size: 8, font: regular, color: rgb(0.5, 0.48, 0.44),
    })

    return doc.save()
}

// ── Helpers ──

function drawSectionHeader(page: PDFPage, font: PDFFont, title: string, y: number): number {
    page.drawText(title, { x: MARGIN, y, size: 9, font, color: MUTED })
    page.drawRectangle({ x: MARGIN, y: y - 4, width: CONTENT_WIDTH, height: 0.5, color: rgb(0.85, 0.85, 0.83) })
    return y - 16
}

function drawSection(
    page: PDFPage,
    bold: PDFFont,
    regular: PDFFont,
    title: string,
    text: string,
    y: number
): number {
    y = drawSectionHeader(page, bold, title, y)
    y = drawWrappedText(page, regular, text, y, 10, INK)
    return y - 12
}

function drawWrappedText(
    page: PDFPage,
    font: PDFFont,
    text: string,
    y: number,
    size: number,
    color = INK,
    xStart = MARGIN
): number {
    const maxWidth = PAGE_WIDTH - xStart - MARGIN
    const sanitized = text.replace(/\s+/g, ' ').trim()
    const words = sanitized.split(' ')
    let line = ''
    let cursorY = y

    for (const word of words) {
        const candidate = line ? `${line} ${word}` : word
        const width = font.widthOfTextAtSize(candidate, size)
        if (width > maxWidth && line) {
            page.drawText(line, { x: xStart, y: cursorY, size, font, color })
            cursorY -= size + 4
            line = word
        } else {
            line = candidate
        }
    }
    if (line) {
        page.drawText(line, { x: xStart, y: cursorY, size, font, color })
        cursorY -= size + 4
    }

    return cursorY - 2
}

function drawBar(
    page: PDFPage,
    regular: PDFFont,
    bold: PDFFont,
    label: string,
    pct: number,
    y: number
): number {
    const barMaxWidth = CONTENT_WIDTH * 0.6
    const barWidth = Math.max(2, (pct / 100) * barMaxWidth)

    page.drawText(capitalize(label), { x: MARGIN, y, size: 9, font: bold, color: INK })
    page.drawText(`${pct}%`, {
        x: MARGIN + barMaxWidth + 8, y, size: 9, font: regular, color: MUTED,
    })

    // Background bar
    page.drawRectangle({ x: MARGIN, y: y - 12, width: barMaxWidth, height: 5, color: rgb(0.88, 0.88, 0.86) })
    // Fill bar
    page.drawRectangle({ x: MARGIN, y: y - 12, width: barWidth, height: 5, color: GOLD })

    return y - 22
}

function capitalize(text: string): string {
    return text.charAt(0).toUpperCase() + text.slice(1)
}