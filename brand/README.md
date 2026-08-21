# SlaydX belgisi

Manba — SVG. PNG lar shundan chiqariladi, qo'lda tahrirlanmaydi.

| Fayl | Vazifasi |
|---|---|
| `mark.svg` | To'liq belgi — deka + slayd + X. ≥180 px uchun |
| `mark-small.svg` | Soddalashtirilgan — faqat X. ≤128 px (favicon, yon panel) |
| `mark-maskable.svg` | Android `maskable` — belgi markazda 66%, fon to'liq |

To'liq belgi kichik o'lchamda loyqalanadi: deka va oq varaq X bilan
qo'shilib ketadi. Yon panel logoni **32 px** da chizadi, shuning uchun
`public/logo.png` ham soddalashtirilgan variantdan (128 px) chiqariladi —
bu standart amaliyot, xato emas. To'liq belgi faqat 180 px va undan
kattada (apple-icon, manifest) ishlatiladi.

## Qayta chiqarish

```bash
node -e "
const sharp=require('sharp'),fs=require('fs');
const full=fs.readFileSync('brand/mark.svg'),
      small=fs.readFileSync('brand/mark-small.svg'),
      mask=fs.readFileSync('brand/mark-maskable.svg');
const png=(b,s,out)=>sharp(b).resize(s,s).png({compressionLevel:9}).toFile(out);
(async()=>{
  await png(small,128,'public/logo.png');
  await png(full,192,'public/icon-192.png');
  await png(full,512,'public/icon-512.png');
  await png(mask,512,'public/icon-maskable.png');
  await png(small,32,'app/icon.png');
  await png(full,180,'app/apple-icon.png');
})();"
```

`app/icon.png` va `app/apple-icon.png` — Next.js App Router konvensiyasi:
ular `<link rel=icon>` teglarini o'zi qo'shadi.

## Palitra

| | |
|---|---|
| Fon | `#1e2f52` → `#0b1120` |
| X | `#7dd3fc` → `#6366f1` → `#f43f5e` |
| Varaq | `#f8fafc` |
