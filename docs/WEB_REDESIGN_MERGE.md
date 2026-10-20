# Runway Style Web Redesign — Merge Preparation

## وضعیت

این سند برای ادغام نهایی بازطراحی وب Runway Style آماده شده است. تغییرات در شاخه‌ی `design/runway-editorial` قرار دارند. تاکنون هیچ commit، push، merge یا deploy روی `main` انجام نشده است.

## خلاصه‌ی تغییرات

نسخه‌ی اول یک تجربه‌ی responsive و editorial برای Runway Style اضافه می‌کند. طراحی بر اساس مرجع تصویری تأییدشده ساخته شده و شامل hero سینمایی، مسیر ساخت آواتار، استودیو برای ترکیب لباس، wardrobe preview و virtual runway است.

سیستم بصری شامل Midpoint Indigo `#252844`، Vanilla Cream `#EEEBD0`، سطح روشن `#F7F4E9`، متن تیره `#171A2C` و accent گرم `#CBB99B` است. تیترها از Playfair Display و رابط کاربری از Inter/DM Sans استفاده می‌کند. layout از ترکیب‌بندی editorial نامتقارن، کارت‌های قاب‌دار نرم، شماره‌گذاری بخش‌ها و panelهای indigo استفاده می‌کند.

## فایل‌های اضافه و تغییرکرده

- `apps/web/index.html`: shell، metadata و عنوان صفحه.
- `apps/web/package.json`: workspace مستقل Vite/React برای web.
- `apps/web/src/App.tsx`: ترکیب صفحه، navigation، hero، avatar flow، studio، wardrobe و runway interactions.
- `apps/web/src/styles.css`: design tokens، responsive breakpoints، animation، focus state و reduced-motion.
- `apps/web/src/main.tsx`: ورودی React.
- `apps/web/src/vite-env.d.ts`: declarationهای Vite و CSS برای TypeScript.
- `apps/web/vite.config.ts`: Vite config و allowlist دامنه‌های Preview Manus.
- `apps/web/tsconfig.json`: تنظیمات strict TypeScript.
- `apps/web/public/manus-routes.json`: route manifest صفحه‌ی اصلی.
- `pnpm-lock.yaml`: dependency graph workspace پس از اضافه‌شدن web app.
- `plan.md` و `TODO.md`: تصمیم‌های طراحی، scope و outcomeهای تأییدشده.

فایل `apps/web/.gitkeep` حذف شده چون اکنون این مسیر دارای implementation واقعی است.

## رفتارهای قابل استفاده

Navigation با دکمه‌های native کار می‌کند و به sectionهای صفحه scroll می‌کند. منوی موبایل باز و بسته می‌شود. انتخاب Look در Studio وضعیت فعال را تغییر می‌دهد. کنترل‌های Virtual Runway فریم نمایشی را تغییر می‌دهند. بخش avatar creation، photo setup را نمایش می‌دهد اما به‌درستی اعلام می‌کند که تولید واقعی avatar تا آماده‌شدن backend فعال نیست.

## دسترسی‌پذیری

صفحه دارای skip link، landmarkهای `header`، `main` و `footer`، heading hierarchy، alt text برای تصاویر، accessible name برای icon buttonها، focus-visible، navigation با keyboard، targetهای لمسی حداقل 24px و fallback برای `prefers-reduced-motion` است. Home در navigation دارای `aria-current="page"` است.

## تصاویر و Storage

تصاویر editorial فعلاً از مسیرهای مدیریت‌شده‌ی Manus Storage استفاده می‌کنند:

- `/manus-storage/async-images/SSqW4mfpxndpBm6G6cF5LY/image-1.webp`
- `/manus-storage/async-images/SSqW4mfpxndpBm6G6cF5LY/image-2.webp`
- `/manus-storage/async-images/SSqW4mfpxndpBm6G6cF5LY/image-3.webp`
- `/manus-storage/async-images/SSqW4mfpxndpBm6G6cF5LY/image-4.webp`

قبل از production merge باید مشخص شود که این مسیرها در hosting نهایی قابل دسترسی هستند. اگر deployment خارج از Manus انجام می‌شود، تصاویر باید به assetهای durable پروژه منتقل شوند و URLهای `App.tsx` جایگزین شوند. تا پیش از آن، این branch برای Manus Preview آماده است.

## بررسی‌های انجام‌شده

دستورهای زیر با موفقیت اجرا شده‌اند:

```bash
pnpm install --ignore-scripts
pnpm --filter @runway/web build
git diff --check
```

همچنین بررسی شد که:

- `GET /` پاسخ `200` می‌دهد.
- `GET /manus-routes.json` پاسخ `200` و JSON معتبر می‌دهد.
- preview دسکتاپ 1440px و mobile در viewport 390px بررسی شده‌اند.
- 4 تصویر دارای alt text هستند.
- 22 کنترل native در رابط وجود دارد.
- reduced-motion و landmarkهای اصلی در source حاضر هستند.
- دامنه‌ی Preview Manus با `allowedHosts: ['.manus.computer']` مجاز شده است.

## روش ادغام پیشنهادی

این مراحل را فقط پس از تأیید صریح مالک پروژه اجرا کنید:

```bash
cd /home/ubuntu/runway-style-platform

git status --short --branch
git fetch origin
git switch main
git pull --ff-only origin main
git merge --no-ff design/runway-editorial -m "feat(web): add Runway Style editorial experience"
pnpm install --frozen-lockfile
pnpm --filter @runway/web build
git diff --check
git push origin main
```

قبل از `git push` باید dependency lockfile، مسیر Storage تصاویر، hosting نهایی و وضعیت deploy بررسی شوند. هیچ‌یک از دستورات ادغام یا push در این task اجرا نشده‌اند.

## نکته‌ی Preview موقت

لینک‌های `3000-...manus.computer` به سرویس زنده‌ی همین sandbox وابسته‌اند و دائمی نیستند. اگر سرویس sandbox متوقف یا hibernate شود، صفحه‌ی `This page is currently unavailable` یا `502 Bad Gateway` دیده می‌شود. این خطا به معنی خراب‌بودن UI نیست؛ با restart سرویس dev یا بازکردن Preview از پنل پروژه، لینک دوباره در دسترس قرار می‌گیرد.
