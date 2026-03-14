# TKGM Harita Arayüzü

Node.js ile çalışan, CesiumJS tabanlı tam ekran dikey harita arayüzü. Terminal konsolundan koordinat girerek haritada o konuma gidebilirsiniz.

## Kurulum

```bash
npm install
```

### Google Drive (Opsiyonel)

Video/fotoğraflar otomatik olarak Drive'a yüklenir. Yükleme başarılıysa sunucudan silinir.

**OAuth 2.0 kullanımı (Nisan 2025 sonrası Service Account çalışmıyor):**

1. [Google Cloud Console](https://console.cloud.google.com) → Proje → APIs & Services → **Google Drive API** etkinleştir
2. Credentials → **Create Credentials** → **OAuth client ID** → Application type: **Web application**
3. Authorized redirect URIs: `http://localhost:3010/api/drive-auth/callback` (sunucu farklı host/port ise onu ekle)
4. Client ID ve Client Secret'ı env'e ekle: `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`
5. Sunucuyu başlat, tarayıcıda **http://localhost:3010/api/drive-auth** adresine git
6. Google ile giriş yap, izin ver → Refresh token kaydedilir

## Çalıştırma

```bash
npm start
```

1. Tarayıcıda **http://localhost:3000** adresini açın
2. Terminalde koordinat girin (enlem boylam formatında)
3. Harita otomatik olarak o konuma uçacak

## Koordinat Formatları

- `41.0082 28.9784` - İstanbul
- `39.9334 32.8597` - Ankara
- `41.0082, 28.9784` - virgül ile de yazılabilir
- `goto 41.0082 28.9784` - goto öneki ile

## Çıkış

Terminalde `q` veya `exit` yazarak sunucuyu kapatabilirsiniz.
