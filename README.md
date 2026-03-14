# TKGM Harita Arayüzü

Node.js ile çalışan, CesiumJS tabanlı tam ekran dikey harita arayüzü. Terminal konsolundan koordinat girerek haritada o konuma gidebilirsiniz.

## Kurulum

```bash
npm install
```

### Google Drive (Opsiyonel)

Video/fotoğraflar otomatik olarak Drive'a yüklenir. Yükleme başarılıysa sunucudan silinir.

**Önemli:** Service Account'ın kendi storage'ı yok. Paylaşılan klasör zorunlu.

1. [Google Cloud Console](https://console.cloud.google.com) → Proje oluştur
2. APIs & Services → Enable APIs → **Google Drive API** etkinleştir
3. Credentials → Create Credentials → **Service Account** → JSON key indir → `google-credentials.json` olarak proje köküne koy
4. **Drive'da klasör oluştur** → Sağ tık → Paylaş → Service Account email (`xxx@xxx.iam.gserviceaccount.com`) ekle → **Editor** ver
5. Klasör URL'sinden ID al: `https://drive.google.com/drive/folders/1abc...xyz` → `1abc...xyz` kısmı
6. `GOOGLE_DRIVE_ROOT_FOLDER_ID=1abc...xyz` env değişkenini ayarla

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
