import Image from 'next/image'
import Link from 'next/link'

// The GymPro logo linking back to the welcome page, in the version that suits the theme.
// The auth pages use it too: in the installed app there is no browser back button.
export function LogoLink() {
    return (
        <Link href="/" className="inline-flex min-h-11 shrink-0 items-center">
            <Image src="/logo-horizontal-light.svg" alt="GymPro" width={260} height={80}
                loading="eager" className="block h-8 w-auto dark:hidden" />
            <Image src="/logo-horizontal-dark.svg" alt="GymPro" width={260} height={80}
                loading="eager" className="hidden h-8 w-auto dark:block" />
        </Link>
    )
}
