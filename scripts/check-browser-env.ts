// Free check of where the add-to-home-screen guide thinks GymPro is open (lib/browser-env.ts),
// with real user agents: Safari and the other iPhone browsers, an iPad asking for desktop sites,
// other phones and computers, and the installed app.
//   npm run check:browser-env
import { browserEnv, type BrowserEnv } from '../lib/browser-env'

let failed = 0
const check = (name: string, got: string, want: string) => {
    const ok = got === want
    if (!ok) failed++
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `: got ${got}, expected ${want}`}`)
}

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko)'
const CASES: [name: string, ua: string, want: BrowserEnv, opts?: { standalone?: boolean; touchMac?: boolean }][] = [
    ['iPhone Safari', `${IPHONE} Version/18.1 Mobile/15E148 Safari/604.1`, 'ios_safari'],
    ['iPhone Safari, iOS 26', 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1', 'ios_safari'],
    ['iPhone Chrome', `${IPHONE} CriOS/130.0.6723.90 Mobile/15E148 Safari/604.1`, 'ios_other'],
    ['iPhone Firefox', `${IPHONE} FxiOS/132.0 Mobile/15E148 Safari/605.1.15`, 'ios_other'],
    ['iPhone Edge', `${IPHONE} EdgiOS/130.0.2849.80 Version/18.0 Mobile/15E148 Safari/604.1`, 'ios_other'],
    ['iPad asking for desktop sites', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15', 'ios_safari', { touchMac: true }],
    ['a Mac', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15', 'other'],
    ['Android Chrome', 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36', 'other'],
    ['Windows Chrome', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36', 'other'],
    // From the home screen there is nothing to do, whatever the agent says
    ['the installed app', `${IPHONE} Mobile/15E148`, 'installed', { standalone: true }],
]
for (const [name, ua, want, opts] of CASES) check(name, browserEnv(ua, opts), want)

console.log(failed ? `\n${failed} check(s) failed` : '\nThe install guide reads every browser right')
process.exit(failed ? 1 : 0)
