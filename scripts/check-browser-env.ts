// Free check of where the add-to-home-screen guide thinks GymPro is open (lib/browser-env.ts),
// with real user agents: Safari and the other iPhone browsers, LINE and other apps' own
// browsers (which can't install), an iPad asking for desktop sites, and the installed app.
//   npm run check:browser-env
import { browserEnv, externalBrowserUrl, type BrowserEnv } from '../lib/browser-env'

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
    ['LINE on iPhone', `${IPHONE} Mobile/15E148 Safari Line/14.18.0`, 'line'],
    ['LINE on Android', 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.0.0 Mobile Safari/537.36 Line/14.18.1/IAB', 'line'],
    ['Instagram on iPhone', `${IPHONE} Mobile/15E148 Instagram 355.0.0.20.108 (iPhone15,2; iOS 18_1; zh_TW; zh-Hant; scale=3.00; 1179x2556; 652349063)`, 'in_app'],
    ['Facebook on iPhone', `${IPHONE} Mobile/15E148 [FBAN/FBIOS;FBAV/485.0.0.40.104;FBBV/650543282;FBDV/iPhone15,2;FBMD/iPhone;FBSN/iOS;FBSV/18.1;FBSS/3;FBCR/;FBID/phone;FBLC/zh_TW;FBOP/80]`, 'in_app'],
    ['Messenger on iPhone', `${IPHONE} Mobile/15E148 [FBAN/MessengerForiOS;FBAV/480.0.0.40.110;FBBV/640000000;FBDV/iPhone15,2;FBMD/iPhone;FBSN/iOS;FBSV/18.1]`, 'in_app'],
    ['the Google app on iPhone', `${IPHONE} GSA/341.0.704946076 Mobile/15E148 Safari/604.1`, 'in_app'],
    ['iPad asking for desktop sites', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15', 'ios_safari', { touchMac: true }],
    ['a Mac', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15', 'other'],
    ['Android Chrome', 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36', 'other'],
    ['Windows Chrome', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36', 'other'],
    // "Online/" is not LINE: the name needs a word boundary
    ['an agent with "Online/" in it', `${IPHONE} Version/18.1 Mobile/15E148 Safari/604.1 Online/2.0`, 'ios_safari'],
    // From the home screen there is nothing to do, whatever the agent says
    ['the installed app', `${IPHONE} Mobile/15E148`, 'installed', { standalone: true }],
    ['the installed app, opened from LINE first', `${IPHONE} Mobile/15E148 Safari Line/14.18.0`, 'installed', { standalone: true }],
]
for (const [name, ua, want, opts] of CASES) check(name, browserEnv(ua, opts), want)

check('LINE leaves for the browser with its parameter', externalBrowserUrl('https://gympro.chichi.mom/login'), 'https://gympro.chichi.mom/login?openExternalBrowser=1')
check('and keeps the query already there', externalBrowserUrl('https://gympro.chichi.mom/signup?ref=line'), 'https://gympro.chichi.mom/signup?ref=line&openExternalBrowser=1')

console.log(failed ? `\n${failed} check(s) failed` : '\nThe install guide reads every browser right')
process.exit(failed ? 1 : 0)
