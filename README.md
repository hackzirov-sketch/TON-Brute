# TONfinder — Local TON Wallet Recovery

TONfinder — faqat o‘zingizga tegishli recovery phrase uchun yaratilgan lokal,
read-only Flask web-ilova. U V3R2, V4R2 va V5R1 wallet manzillarini rasmiy TON
kutubxonalari orqali hosil qiladi va, offline rejim o‘chirilgan bo‘lsa, ularning
balansini tekshiradi.

## Birinchi ishga tushirish

1. Kompyuterda Python 3 va Node.js 22+ o‘rnatilgan bo‘lishi kerak.
2. `setup.bat` faylini bir marta oching.
3. O‘rnatish tugagach `start.bat` faylini oching.
4. Brauzer avtomatik ravishda `http://127.0.0.1:5000` manzilini ochadi.

Bu endi CLI dastur emas: barcha boshqaruv lokal web-interfeys orqali amalga
oshiriladi.

## Nima qiladi

- 12 yoki 24 so‘zli TON mnemonic’ni tekshiradi;
- V3R2, V4R2 va V5R1 manzillarini hosil qiladi;
- Mainnet va testnet formatlarini to‘g‘ri ajratadi;
- TON Center orqali balans va account holatini read-only tekshiradi;
- offline rejimda hech qanday blockchain API so‘rovi yubormaydi;
- UQ va EQ address formatlarini alohida ko‘rsatadi.

## Xavfsizlik chegaralari

- Server faqat `127.0.0.1` / localhost’da ishlaydi.
- Recovery phrase argument, log, database yoki faylga yozilmaydi.
- Phrase Node derivation moduliga standart kirish orqali vaqtincha uzatiladi.
- Private key foydalanuvchiga chiqarilmaydi va saqlanmaydi.
- Transfer, transaction signing va seed-list scanning funksiyalari yo‘q.
- Sahifada `no-store`, CSP, frame protection va CSRF himoyalari yoqilgan.
- Tekshiruv muvaffaqiyatli tugagach phrase input maydoni avtomatik tozalanadi.

JavaScript va Python xotirasini darhol va mutlaq tozalashga kafolat berib
bo‘lmaydi. Ish tugagach sahifani va server oynasini yoping. Recovery phrase’ni
chat, bot, screenshot yoki begona saytga hech qachon yubormang.

## Developer tekshiruvi

```powershell
npm run build
npm test
.venv\Scripts\python.exe -m pytest
```

Web server production-style Waitress orqali ishga tushadi. Internetga deploy
qilish ko‘zda tutilmagan va xavfsizlik sabab localhost’dan tashqari host’da
ishga tushish bloklangan.
