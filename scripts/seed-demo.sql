-- ═══════════════════════════════════════════════════════════════════════════════
-- SEED: Demo-App Tenant Dummy Data
-- Schema  : tenant_demo_app
-- Target  : 100 patients · 100 doctors · 100 nurses · 50 admins · 10000 sessions · 8000 notes
-- Password: Password123!  (bcrypt cost-10, computed once via pgcrypto)
-- Status  : 8000 COMPLETED · 500 FAILED · 1500 CREATED (upcoming)
--
-- Run ONCE against your NeonDB (or any Postgres) database.
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS pgcrypto;

SET search_path TO tenant_demo_app, public;

DO $$
DECLARE
  -- ── core ──────────────────────────────────────────────────────────────────
  v_tenant_id   TEXT;
  v_pw_hash     TEXT;
  i             INT;

  -- ── per-user scratch ──────────────────────────────────────────────────────
  v_uid         TEXT;
  v_first       TEXT;
  v_last        TEXT;
  v_full_name   TEXT;
  v_email       TEXT;
  v_phone       TEXT;

  -- ── collected IDs (to reference when building sessions) ──────────────────
  doctor_ids    TEXT[] := '{}';
  patient_ids   TEXT[] := '{}';
  patient_names TEXT[] := '{}';
  nurse_ids     TEXT[] := '{}';
  admin_ids     TEXT[] := '{}';

  -- ── session scratch ───────────────────────────────────────────────────────
  v_sess_id       TEXT;
  v_pat_id        TEXT;
  v_pat_name      TEXT;
  v_doc_id        TEXT;
  v_adm_id        TEXT;
  v_nur_id        TEXT;
  v_sched_date    DATE;
  v_sched_start   TIMESTAMPTZ;
  v_sched_end     TIMESTAMPTZ;
  v_started_at    TIMESTAMPTZ;
  v_ended_at      TIMESTAMPTZ;
  v_status        TEXT;
  v_dur_min       INT;
  v_dur_sec       INT;
  v_days_ago      INT;
  v_is_finalized  BOOLEAN;
  v_finalized_at  TIMESTAMPTZ;

  -- ── name pools ────────────────────────────────────────────────────────────
  male_names    TEXT[] := ARRAY[
    'Ahmad','Budi','Cahyo','Dedi','Eko','Fajar','Gunawan','Hendra',
    'Indra','Joko','Kurnia','Lukman','Muhamad','Nandang','Otto',
    'Prasetyo','Rifki','Rudi','Slamet','Teguh','Umar','Wahyu',
    'Yoga','Zulfikar','Arif','Bagas','Dani','Firman','Hadi',
    'Jamil','Koko','Lukas','Maman','Natan','Oscar','Supri',
    'Tono','Wawan','Yudi','Zainal','Bambang','Ivan','Kevin',
    'Leo','Marko','Nino','Prio','Samuel','Taufik','Yanto'
  ];
  female_names  TEXT[] := ARRAY[
    'Dewi','Ayu','Sari','Putri','Nita','Wati','Ratna','Sri',
    'Lia','Maya','Nurul','Fitri','Lina','Rina','Dian',
    'Evi','Fani','Gita','Hani','Indah','Juwita','Kartika',
    'Laila','Mira','Nina','Okta','Pita','Rini','Susi',
    'Tina','Uli','Vera','Wilda','Yuni','Zahra','Ana',
    'Bella','Citra','Desi','Erna','Fira','Gina','Hesti',
    'Ika','Jihan','Karin','Lestari','Mega','Nova','Shinta'
  ];
  last_names    TEXT[] := ARRAY[
    'Santoso','Wijaya','Kusuma','Permana','Setiawan',
    'Rahayu','Hartono','Sugiarto','Wibowo','Prasetyo',
    'Haryanto','Susanto','Hendro','Kurniawan','Utama',
    'Suharto','Saputra','Putra','Hidayat','Nugroho',
    'Mardiyanto','Heriyanto','Gunawan','Firmansyah','Wahyudi',
    'Prabowo','Mahendra','Yulianto','Sulistyo','Santosa',
    'Irawan','Mulyono','Triyanto','Supriadi','Budiman',
    'Wicaksono','Pangestu','Iskandar','Pranoto','Ginanjar'
  ];

  specializations TEXT[] := ARRAY[
    'Dokter Umum','Spesialis Anak','Spesialis Jantung',
    'Spesialis Penyakit Dalam','Spesialis Bedah',
    'Spesialis Kulit & Kelamin','Spesialis Mata','Spesialis THT',
    'Spesialis Ortopedi','Spesialis Saraf','Spesialis Kandungan',
    'Spesialis Paru','Spesialis Jiwa','Spesialis Gigi',
    'Spesialis Urologi','Spesialis Endokrin','Spesialis Onkologi',
    'Spesialis Rehabilitasi Medis','Spesialis Gizi Klinik','Spesialis Geriatri'
  ];
  poli_list     TEXT[] := ARRAY[
    'Poli Umum','Poli Anak','Poli Jantung','Poli Penyakit Dalam',
    'Poli Bedah','Poli Kulit','Poli Mata','Poli THT',
    'Poli Ortopedi','Poli Saraf','Poli Kandungan','Poli Paru',
    'Poli Jiwa','Poli Gigi','Poli Urologi'
  ];
  city_list     TEXT[] := ARRAY[
    'Jakarta','Surabaya','Bandung','Medan','Semarang',
    'Makassar','Palembang','Depok','Tangerang','Bekasi',
    'Bogor','Malang','Yogyakarta','Solo','Denpasar'
  ];
  reason_list   TEXT[] := ARRAY[
    'Demam dan sakit kepala','Batuk dan pilek','Nyeri perut',
    'Konsultasi rutin','Tekanan darah tinggi','Diabetes follow-up',
    'Sakit punggung','Alergi kulit','Gangguan tidur',
    'Kecemasan dan stres','Nyeri sendi','Diare',
    'Sesak napas','Nyeri dada','Pusing dan mual',
    'Pemeriksaan umum','Infeksi saluran kemih','Migrain',
    'Cedera ringan','Konsultasi gizi'
  ];

  -- ── SOAP note pools (20 entries, match reason_list length) ───────────────
  subjective_list TEXT[] := ARRAY[
    'Pasien mengeluhkan demam sejak 3 hari disertai sakit kepala berdenyut.',
    'Batuk berdahak dan hidung tersumbat sejak 5 hari lalu.',
    'Nyeri perut bagian atas sejak kemarin, mual, belum muntah.',
    'Pasien datang untuk kontrol rutin, tidak ada keluhan bermakna.',
    'Kepala terasa berat dan tengkuk kaku, riwayat hipertensi diketahui.',
    'Kontrol gula darah, patuh minum obat, tidak ada episode hipoglikemia.',
    'Nyeri punggung bawah sejak 2 hari, memberat saat berdiri lama.',
    'Ruam merah dan gatal di lengan dan leher sejak 2 hari lalu.',
    'Sulit tidur sejak 2 minggu, sering terbangun tengah malam.',
    'Merasa cemas berlebihan, jantung berdebar, sulit berkonsentrasi.',
    'Nyeri dan kaku sendi lutut, terutama di pagi hari setelah bangun tidur.',
    'BAB cair lebih dari 5 kali sejak pagi, tidak ada lendir atau darah.',
    'Sesak napas saat aktivitas ringan sejak 3 hari lalu.',
    'Nyeri dada kiri, tidak menjalar, tidak memburuk dengan aktivitas.',
    'Pusing berputar dan mual sejak kemarin pagi, tidak ada gangguan pendengaran.',
    'Pemeriksaan kesehatan rutin, tidak ada keluhan aktif saat ini.',
    'Nyeri saat berkemih dan sering buang air kecil sejak 3 hari lalu.',
    'Sakit kepala sebelah kiri berdenyut, sensitif cahaya dan suara.',
    'Terkilir pergelangan kaki kanan saat berolahraga tadi pagi.',
    'Ingin konsultasi pola makan sehat untuk menurunkan berat badan.'
  ];
  objective_list  TEXT[] := ARRAY[
    'TD: 120/80 mmHg, N: 88x/mnt, S: 38.2°C, RR: 20x/mnt. Faring hiperemis, KGB tidak membesar.',
    'TD: 110/70 mmHg, N: 80x/mnt, S: 37.2°C. Ronkhi (-), wheezing (-), sekret hidung mukopurulen.',
    'TD: 118/76 mmHg, N: 90x/mnt, S: 37.0°C. Nyeri tekan epigastrium (+), bising usus normal.',
    'TD: 130/85 mmHg, N: 78x/mnt, S: 36.8°C. Pemeriksaan fisik dalam batas normal.',
    'TD: 160/100 mmHg, N: 84x/mnt, S: 36.9°C. Tidak ada edema, bunyi jantung reguler.',
    'TD: 126/82 mmHg, N: 76x/mnt, S: 36.7°C. GDS: 145 mg/dL. Tidak ada ulkus diabetik.',
    'TD: 122/78 mmHg, N: 80x/mnt, S: 36.8°C. Nyeri tekan paravertebral L4-L5, ROM terbatas.',
    'TD: 112/72 mmHg, N: 82x/mnt, S: 37.0°C. Urtikaria di lengan dan leher, tidak ada angioedema.',
    'TD: 118/76 mmHg, N: 74x/mnt, S: 36.6°C. Tidak ada temuan fisik bermakna.',
    'TD: 128/84 mmHg, N: 96x/mnt, S: 36.8°C. Tremor halus pada tangan, tidak ada kelainan organik.',
    'TD: 124/80 mmHg, N: 78x/mnt, S: 36.7°C. Nyeri tekan sendi lutut bilateral, krepitasi (+).',
    'TD: 106/68 mmHg, N: 94x/mnt, S: 37.1°C. Turgor sedikit menurun, bising usus meningkat.',
    'TD: 124/80 mmHg, N: 88x/mnt, S: 36.9°C. SpO2: 96%. Suara napas menurun di basal kanan.',
    'TD: 134/88 mmHg, N: 86x/mnt, S: 36.8°C. Bunyi jantung S1S2 normal, tidak ada murmur.',
    'TD: 110/70 mmHg, N: 80x/mnt, S: 36.7°C. Nistagmus horizontal (+), Romberg test (+).',
    'TD: 120/78 mmHg, N: 76x/mnt, S: 36.6°C. Pemeriksaan head-to-toe dalam batas normal.',
    'TD: 116/74 mmHg, N: 84x/mnt, S: 37.0°C. Nyeri ketok CVA (-), nyeri suprapubik (+).',
    'TD: 118/76 mmHg, N: 78x/mnt, S: 36.8°C. Fotofobia (+), tidak ada kaku kuduk.',
    'TD: 120/80 mmHg, N: 82x/mnt, S: 36.7°C. Edema pergelangan kaki kanan, nyeri tekan (+).',
    'TD: 122/80 mmHg, N: 76x/mnt, S: 36.6°C. BMI: 28.4 kg/m². Tidak ada kelainan metabolik akut.'
  ];
  assessment_list TEXT[] := ARRAY[
    'Febris ec infeksi virus akut.',
    'ISPA (Infeksi Saluran Pernapasan Atas).',
    'Gastritis akut.',
    'Sehat, tidak ada penyakit aktif.',
    'Hipertensi grade II, belum terkontrol.',
    'Diabetes mellitus tipe 2 terkontrol baik.',
    'Low back pain mekanik.',
    'Urtikaria akut et causa alergi.',
    'Insomnia primer.',
    'Gangguan anxietas umum.',
    'Osteoartritis lutut bilateral.',
    'Diare akut tanpa dehidrasi berat.',
    'Efusi pleura minimal, curiga ec infeksi.',
    'Nyeri dada non-kardiak, suspek muskuloskeletal.',
    'Vertigo perifer.',
    'Sehat, pemeriksaan dalam batas normal.',
    'Infeksi saluran kemih bawah (sistitis akut).',
    'Migrain tanpa aura.',
    'Ankle sprain grade I.',
    'Overweight dengan risiko sindrom metabolik.'
  ];
  plan_list       TEXT[] := ARRAY[
    'Parasetamol 500mg 3x1 bila perlu, perbanyak cairan, istirahat cukup. Kontrol 3 hari bila tidak membaik.',
    'Ambroxol 30mg 3x1, pseudoefedrin 60mg 3x1, kompres hangat, perbanyak minum air.',
    'Antasida 3x1 ac, omeprazol 20mg 1x1 pagi, hindari makanan pedas dan asam.',
    'Lanjutkan gaya hidup sehat. Kontrol 6 bulan atau bila ada keluhan.',
    'Amlodipine 10mg 1x1, diet rendah garam dan lemak, olahraga teratur. Kontrol 2 minggu.',
    'Lanjutkan metformin 500mg 2x1, diet DM, olahraga 30 menit/hari. Cek HbA1c 3 bulan.',
    'Natrium diklofenak 50mg 2x1 pc, fisioterapi, hindari mengangkat beban berat.',
    'Cetirizin 10mg 1x1 malam, identifikasi dan hindari alergen. Kompres dingin bila gatal.',
    'Perbaiki sleep hygiene, hindari kafein setelah jam 14.00. Alprazolam 0.25mg bila perlu.',
    'Konseling kognitif-perilaku. Hindari pemicu stres. Rujuk psikiatri bila tidak membaik 4 minggu.',
    'Glukosamin 1500mg 1x1, fisioterapi sendi lutut, edukasi penurunan berat badan.',
    'Oralit setiap BAB cair, probiotik, diet lunak. Kembali bila ada darah atau demam tinggi.',
    'Azithromisin 500mg 1x1 selama 5 hari, nebulisasi salbutamol, kontrol 3 hari.',
    'Ibuprofen 400mg 3x1 pc, kompres hangat area dada, istirahat cukup.',
    'Betahistin 24mg 2x1, latihan Brandt-Daroff, hindari gerakan kepala tiba-tiba.',
    'Tidak diperlukan pengobatan. Lanjutkan pola hidup sehat, kontrol setahun sekali.',
    'Siprofloksasin 500mg 2x1 selama 7 hari, perbanyak minum air putih minimal 2 liter/hari.',
    'Sumatriptan 50mg bila serangan. Propranolol 40mg 1x1 untuk profilaksis. Hindari pemicu.',
    'RICE (Rest, Ice, Compression, Elevation), NSAID topikal, bebat elastis. Cek ulang 1 minggu.',
    'Konseling diet rendah kalori 1500 kkal/hari, program olahraga terstruktur. Cek profil lipid.'
  ];
  summary_list    TEXT[] := ARRAY[
    'Pasien dengan febris viral. Terapi antipiretik dan edukasi hidrasi diberikan.',
    'ISPA ringan. Terapi simptomatik, pasien diminta istirahat dan perbanyak minum.',
    'Gastritis akut akibat pola makan tidak teratur. Antasida dan PPI diberikan.',
    'Konsultasi rutin. Kondisi pasien baik, tidak ada kelainan bermakna.',
    'Hipertensi grade II. Antihipertensi ditambahkan, edukasi diet diberikan.',
    'Diabetes tipe 2 terkontrol. Obat dilanjutkan, edukasi gaya hidup diperkuat.',
    'Low back pain mekanik. NSAID dan rujukan fisioterapi diberikan.',
    'Urtikaria akut. Antihistamin diberikan, pasien edukasi menghindari alergen.',
    'Insomnia primer. Sleep hygiene counseling dan terapi medikasi minimal.',
    'Gangguan kecemasan umum. Konseling diberikan, rencana rujuk psikiatri bila perlu.',
    'Osteoartritis lutut bilateral. Suplemen dan fisioterapi direkomendasikan.',
    'Diare akut tanpa komplikasi. Rehidrasi oral dan diet lunak, prognosis baik.',
    'Efusi pleura minimal. Antibiotik empiris dimulai, kontrol ketat 3 hari.',
    'Nyeri dada muskuloskeletal. NSAID dan kompres hangat diberikan.',
    'Vertigo perifer. Betahistin dan manuver reposisi diajarkan.',
    'Pemeriksaan rutin normal. Pasien dalam kondisi sehat optimal.',
    'ISK bawah (sistitis). Antibiotik 7 hari dan edukasi hidrasi adekuat.',
    'Migrain. Terapi akut dan profilaksis dimulai, edukasi pemicu migrain.',
    'Ankle sprain grade I. RICE protocol diterapkan, NSAID topikal diberikan.',
    'Overweight. Program diet dan olahraga terstruktur direncanakan bersama pasien.'
  ];

  -- ── enum value pools ──────────────────────────────────────────────────────
  -- service_type uses ServiceType enum (TELEMEDICINE / TELECOUNSELLING)
  svc_types     TEXT[] := ARRAY['TELEMEDICINE','TELECOUNSELLING'];
  sess_types    TEXT[] := ARRAY['SCHEDULED','INSTANT'];
  cons_modes    TEXT[] := ARRAY['VIDEO','VOICE'];
  -- serviceCapability is a free-text column on DoctorProfile
  svc_caps      TEXT[] := ARRAY['TELEMEDICINE','TELECOUNSELING','BOTH'];

BEGIN
  -- ── resolve tenant ────────────────────────────────────────────────────────
  SELECT id INTO v_tenant_id FROM public.tenant_registry WHERE slug = 'demo-app';
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Tenant "demo-app" not found in tenant_registry. Aborting.';
  END IF;
  RAISE NOTICE 'Tenant ID : %', v_tenant_id;

  -- ── bcrypt hash (computed once, reused for all accounts) ─────────────────
  v_pw_hash := crypt('Password123!', gen_salt('bf', 10));
  RAISE NOTICE 'Password hash computed.';

  -- ══════════════════════════════════════════════════════════════════════════
  --  100 PATIENTS
  -- ══════════════════════════════════════════════════════════════════════════
  RAISE NOTICE 'Inserting 100 patients...';
  FOR i IN 1..100 LOOP
    v_uid   := gen_random_uuid()::TEXT;
    v_first := CASE WHEN i % 2 = 0
                 THEN female_names[1 + ((i-1) % array_length(female_names,1))]
                 ELSE male_names  [1 + ((i-1) % array_length(male_names,1))]
               END;
    v_last      := last_names[1 + ((i-1) % array_length(last_names,1))];
    v_full_name := v_first || ' ' || v_last;
    v_email     := lower(v_first) || '.' || lower(v_last) || i || '@patient.demo.com';
    v_phone     := '0812' || lpad(i::TEXT, 8, '0');

    INSERT INTO "User" (id, "tenantId", role, name, "isActive", "createdAt", "updatedAt")
    VALUES (
      v_uid, v_tenant_id, 'PATIENT'::"UserRole", v_full_name, true,
      NOW() - ((1 + (i % 700))::TEXT || ' days')::INTERVAL,
      NOW() - ((i % 100)::TEXT || ' days')::INTERVAL
    );

    INSERT INTO "PatientProfile"
      (id, "tenantId", "userId", "fullName", email, phone, "passwordHash",
       "bornDate", gender, mrn, address, "createdAt", "updatedAt")
    VALUES (
      gen_random_uuid()::TEXT, v_tenant_id, v_uid, v_full_name,
      v_email, v_phone, v_pw_hash,
      CURRENT_DATE - ((20 + (i % 55)) * 365 + (i % 200)),
      CASE WHEN i % 2 = 0 THEN 'FEMALE' ELSE 'MALE' END,
      'MRN-' || lpad(i::TEXT, 5, '0'),
      'Jl. ' || v_last || ' No.' || i || ', ' || city_list[1 + ((i-1) % array_length(city_list,1))],
      NOW() - ((1 + (i % 700))::TEXT || ' days')::INTERVAL,
      NOW() - ((i % 100)::TEXT || ' days')::INTERVAL
    );

    INSERT INTO "MrnWhitelist" (id, "tenantId", mrn, "createdAt")
    VALUES (gen_random_uuid()::TEXT, v_tenant_id, 'MRN-' || lpad(i::TEXT, 5, '0'), NOW());

    patient_ids   := array_append(patient_ids,   v_uid);
    patient_names := array_append(patient_names, v_full_name);
  END LOOP;
  RAISE NOTICE '  done.';

  -- ══════════════════════════════════════════════════════════════════════════
  --  100 DOCTORS
  -- ══════════════════════════════════════════════════════════════════════════
  RAISE NOTICE 'Inserting 100 doctors...';
  FOR i IN 1..100 LOOP
    v_uid   := gen_random_uuid()::TEXT;
    v_first := CASE WHEN i % 3 = 0
                 THEN 'dr. ' || female_names[1 + ((i-1) % array_length(female_names,1))]
                 ELSE 'dr. ' || male_names  [1 + ((i-1) % array_length(male_names,1))]
               END;
    v_last      := last_names[1 + ((i + 10 - 1) % array_length(last_names,1))];
    v_full_name := v_first || ' ' || v_last;
    v_email     := 'dokter' || i || '@staff.demo.com';
    v_phone     := '0813' || lpad(i::TEXT, 8, '0');

    INSERT INTO "User" (id, "tenantId", role, name, "isActive", "createdAt", "updatedAt")
    VALUES (
      v_uid, v_tenant_id, 'DOCTOR'::"UserRole", v_full_name, true,
      NOW() - ((1 + (i % 500))::TEXT || ' days')::INTERVAL,
      NOW() - ((i % 50)::TEXT || ' days')::INTERVAL
    );

    INSERT INTO "DoctorProfile"
      (id, "tenantId", "userId", "fullName", email, phone, "passwordHash",
       license, specialization, poli, "serviceCapability", "createdAt", "updatedAt")
    VALUES (
      gen_random_uuid()::TEXT, v_tenant_id, v_uid, v_full_name,
      v_email, v_phone, v_pw_hash,
      'SIP.' || lpad(i::TEXT, 4, '0') || '/DOK/2024',
      specializations[1 + ((i-1) % array_length(specializations,1))],
      poli_list     [1 + ((i-1) % array_length(poli_list,1))],
      svc_caps      [1 + ((i-1) % 3)],
      NOW() - ((1 + (i % 500))::TEXT || ' days')::INTERVAL,
      NOW() - ((i % 50)::TEXT || ' days')::INTERVAL
    );

    INSERT INTO "LicenseWhitelist" (id, "tenantId", license, "createdAt")
    VALUES (gen_random_uuid()::TEXT, v_tenant_id, 'SIP.' || lpad(i::TEXT, 4, '0') || '/DOK/2024', NOW());

    doctor_ids := array_append(doctor_ids, v_uid);
  END LOOP;
  RAISE NOTICE '  done.';

  -- ══════════════════════════════════════════════════════════════════════════
  --  100 NURSES
  -- ══════════════════════════════════════════════════════════════════════════
  RAISE NOTICE 'Inserting 100 nurses...';
  FOR i IN 1..100 LOOP
    v_uid   := gen_random_uuid()::TEXT;
    v_first := CASE WHEN i % 4 = 0
                 THEN male_names  [1 + ((i-1) % array_length(male_names,1))]
                 ELSE female_names[1 + ((i-1) % array_length(female_names,1))]
               END;
    v_last      := last_names[1 + ((i + 20 - 1) % array_length(last_names,1))];
    v_full_name := v_first || ' ' || v_last;
    v_email     := 'perawat' || i || '@staff.demo.com';
    v_phone     := '0814' || lpad(i::TEXT, 8, '0');

    INSERT INTO "User" (id, "tenantId", role, name, "isActive", "createdAt", "updatedAt")
    VALUES (
      v_uid, v_tenant_id, 'NURSE'::"UserRole", v_full_name, true,
      NOW() - ((1 + (i % 400))::TEXT || ' days')::INTERVAL,
      NOW() - ((i % 50)::TEXT || ' days')::INTERVAL
    );

    INSERT INTO "NurseProfile"
      (id, "tenantId", "userId", "fullName", email, phone, "passwordHash",
       "nurseId", poli, "createdAt", "updatedAt")
    VALUES (
      gen_random_uuid()::TEXT, v_tenant_id, v_uid, v_full_name,
      v_email, v_phone, v_pw_hash,
      'NS-' || lpad(i::TEXT, 5, '0'),
      poli_list[1 + ((i-1) % array_length(poli_list,1))],
      NOW() - ((1 + (i % 400))::TEXT || ' days')::INTERVAL,
      NOW() - ((i % 50)::TEXT || ' days')::INTERVAL
    );

    INSERT INTO "NurseIdWhitelist" (id, "tenantId", "nurseId", "createdAt")
    VALUES (gen_random_uuid()::TEXT, v_tenant_id, 'NS-' || lpad(i::TEXT, 5, '0'), NOW());

    nurse_ids := array_append(nurse_ids, v_uid);
  END LOOP;
  RAISE NOTICE '  done.';

  -- ══════════════════════════════════════════════════════════════════════════
  --  50 ADMINS
  -- ══════════════════════════════════════════════════════════════════════════
  RAISE NOTICE 'Inserting 50 admins...';
  FOR i IN 1..50 LOOP
    v_uid   := gen_random_uuid()::TEXT;
    v_first := CASE WHEN i % 2 = 0
                 THEN female_names[1 + ((i-1) % array_length(female_names,1))]
                 ELSE male_names  [1 + ((i-1) % array_length(male_names,1))]
               END;
    v_last      := last_names[1 + ((i + 30 - 1) % array_length(last_names,1))];
    v_full_name := v_first || ' ' || v_last;
    v_email     := 'admin' || i || '@staff.demo.com';
    v_phone     := '0815' || lpad(i::TEXT, 8, '0');

    INSERT INTO "User" (id, "tenantId", role, name, "isActive", "createdAt", "updatedAt")
    VALUES (
      v_uid, v_tenant_id, 'ADMIN'::"UserRole", v_full_name, true,
      NOW() - ((1 + (i % 300))::TEXT || ' days')::INTERVAL,
      NOW() - ((i % 30)::TEXT || ' days')::INTERVAL
    );

    INSERT INTO "AdminProfile"
      (id, "tenantId", "userId", "fullName", email, phone, "passwordHash",
       "adminId", "createdAt", "updatedAt")
    VALUES (
      gen_random_uuid()::TEXT, v_tenant_id, v_uid, v_full_name,
      v_email, v_phone, v_pw_hash,
      'ADM-' || lpad(i::TEXT, 5, '0'),
      NOW() - ((1 + (i % 300))::TEXT || ' days')::INTERVAL,
      NOW() - ((i % 30)::TEXT || ' days')::INTERVAL
    );

    INSERT INTO "AdminIdWhitelist" (id, "tenantId", "adminId", "createdAt")
    VALUES (gen_random_uuid()::TEXT, v_tenant_id, 'ADM-' || lpad(i::TEXT, 5, '0'), NOW());

    admin_ids := array_append(admin_ids, v_uid);
  END LOOP;
  RAISE NOTICE '  done.';

  -- ══════════════════════════════════════════════════════════════════════════
  --  10000 CONSULTATION SESSIONS
  --  i  1 –  8000  → COMPLETED  (past 2 years, spread evenly)
  --  i  8001 – 8500  → FAILED    (past 1 year)
  --  i  8501 – 10000 → CREATED   (upcoming, next 6 months)
  -- ══════════════════════════════════════════════════════════════════════════
  RAISE NOTICE 'Inserting 10000 consultation sessions (progress every 1000)...';
  FOR i IN 1..10000 LOOP
    v_sess_id := gen_random_uuid()::TEXT;

    -- cycle through user pools
    v_pat_id   := patient_ids[1 + ((i - 1)       % 100)];
    v_pat_name := patient_names[1 + ((i - 1)     % 100)];
    v_doc_id   := doctor_ids  [1 + (((i * 3) - 1) % 100)];
    v_adm_id   := admin_ids   [1 + (((i * 7) - 1)  % 50)];
    v_nur_id   := CASE WHEN i % 3 = 0
                    THEN nurse_ids[1 + (((i * 5) - 1) % 100)]
                    ELSE NULL
                  END;

    v_dur_min := 15 + (i % 46);   -- 15–60 minutes

    IF i <= 8000 THEN
      -- ── COMPLETED ─────────────────────────────────────────────────────────
      v_status      := 'COMPLETED';
      v_days_ago    := 1 + (i % 730);
      v_sched_date  := CURRENT_DATE - v_days_ago;
      v_sched_start := v_sched_date::TIMESTAMPTZ
                       + ((8 + (i % 10))::TEXT || ' hours')::INTERVAL;
      v_sched_end   := v_sched_start + (v_dur_min::TEXT || ' minutes')::INTERVAL;
      v_started_at  := v_sched_start + ((2 + (i % 8))::TEXT || ' minutes')::INTERVAL;
      v_ended_at    := v_started_at  + (v_dur_min::TEXT || ' minutes')::INTERVAL;
      v_dur_sec     := v_dur_min * 60;

    ELSIF i <= 8500 THEN
      -- ── FAILED ────────────────────────────────────────────────────────────
      v_status      := 'FAILED';
      v_days_ago    := 1 + ((i - 8001) % 365);
      v_sched_date  := CURRENT_DATE - v_days_ago;
      v_sched_start := v_sched_date::TIMESTAMPTZ
                       + ((8 + (i % 10))::TEXT || ' hours')::INTERVAL;
      v_sched_end   := v_sched_start + (v_dur_min::TEXT || ' minutes')::INTERVAL;
      v_started_at  := NULL;
      v_ended_at    := NULL;
      v_dur_sec     := NULL;
      v_days_ago    := (i - 8001) % 365 + 1;

    ELSE
      -- ── CREATED (upcoming) ────────────────────────────────────────────────
      v_status      := 'CREATED';
      v_days_ago    := 0;   -- created_at offset = 0 (recent)
      v_sched_date  := CURRENT_DATE + (1 + ((i - 8501) % 180));
      v_sched_start := v_sched_date::TIMESTAMPTZ
                       + ((8 + (i % 10))::TEXT || ' hours')::INTERVAL;
      v_sched_end   := v_sched_start + (v_dur_min::TEXT || ' minutes')::INTERVAL;
      v_started_at  := NULL;
      v_ended_at    := NULL;
      v_dur_sec     := NULL;
    END IF;

    INSERT INTO "ConsultationSession" (
      session_id,       "tenantId",
      patient_id,       doctor_id,
      session_type,     consultation_mode,  service_type,
      reason_for_visit,
      scheduled_date,   scheduled_start_time,  duration_minutes,  scheduled_end_time,
      session_status,
      created_by,       nurse_id,
      room_name,
      doctor_joined_at, patient_joined_at,
      started_at,       ended_at,
      duration_sec,
      error_message,
      patient_name,
      created_at,       updated_at
    ) VALUES (
      v_sess_id,
      v_tenant_id,
      v_pat_id,
      v_doc_id,
      sess_types[1 + (i % 2)]::"SessionType",
      cons_modes[1 + (i % 2)]::"ConsultationMode",
      svc_types [1 + (i % 2)]::"ServiceType",
      reason_list[1 + ((i-1) % array_length(reason_list,1))],
      v_sched_date,
      v_sched_start,
      v_dur_min,
      v_sched_end,
      v_status::"SessionStatus",
      v_adm_id,
      v_nur_id,
      'room-' || v_sess_id,
      CASE WHEN v_status = 'COMPLETED' THEN v_started_at + '30 seconds'::INTERVAL  ELSE NULL END,
      CASE WHEN v_status = 'COMPLETED' THEN v_started_at + '60 seconds'::INTERVAL  ELSE NULL END,
      v_started_at,
      v_ended_at,
      v_dur_sec,
      CASE WHEN v_status = 'FAILED'
           THEN 'Pasien tidak dapat bergabung ke sesi konsultasi'
           ELSE NULL
      END,
      v_pat_name,
      NOW() - ((v_days_ago)::TEXT || ' days')::INTERVAL,
      NOW() - ((v_days_ago / 2)::TEXT || ' days')::INTERVAL
    );

    -- ── ConsultationNote for COMPLETED sessions ─────────────────────────────
    IF v_status = 'COMPLETED' THEN
      v_is_finalized := (i <= 6000);
      v_finalized_at := CASE WHEN v_is_finalized
                           THEN v_ended_at + '30 minutes'::INTERVAL
                           ELSE NULL
                         END;

      INSERT INTO "ConsultationNote" (
        id,           "tenantId",
        consultation_session_id,
        "doctorId",   patient_id,    nurse_id,
        subjective,   objective,     assessment,  plan,
        summary,
        "aiStatus",   "aiModel",     "summarizedAt",
        is_finalized, finalized_at,
        "createdAt",  "updatedAt"
      ) VALUES (
        gen_random_uuid()::TEXT,
        v_tenant_id,
        v_sess_id,
        v_doc_id,
        v_pat_id,
        v_nur_id,
        subjective_list[1 + ((i-1) % array_length(subjective_list,1))],
        objective_list [1 + ((i-1) % array_length(objective_list,1))],
        assessment_list[1 + ((i-1) % array_length(assessment_list,1))],
        plan_list      [1 + ((i-1) % array_length(plan_list,1))],
        CASE WHEN v_is_finalized
             THEN summary_list[1 + ((i-1) % array_length(summary_list,1))]
             ELSE NULL
        END,
        CASE WHEN v_is_finalized THEN 'SUMMARIZED' ELSE NULL END,
        CASE WHEN v_is_finalized THEN 'claude-haiku-4-5' ELSE NULL END,
        CASE WHEN v_is_finalized THEN v_finalized_at + '2 minutes'::INTERVAL ELSE NULL END,
        v_is_finalized,
        v_finalized_at,
        v_ended_at + '1 minute'::INTERVAL,
        v_ended_at + '5 minutes'::INTERVAL
      );
    END IF;

    IF i % 1000 = 0 THEN
      RAISE NOTICE '  sessions: %/10000', i;
    END IF;
  END LOOP;
  RAISE NOTICE '  done.';

  -- ── summary ───────────────────────────────────────────────────────────────
  RAISE NOTICE '═══════════════════════════════════════════';
  RAISE NOTICE 'Seeding complete!';
  RAISE NOTICE '  Patients : 100  (login: patientX@patient.demo.com)';
  RAISE NOTICE '  Doctors  : 100  (login: dokterX@staff.demo.com)';
  RAISE NOTICE '  Nurses   : 100  (login: perawatX@staff.demo.com)';
  RAISE NOTICE '  Admins   :  50  (login: adminX@staff.demo.com)';
  RAISE NOTICE '  Sessions : 10000  (8000 COMPLETED / 500 FAILED / 1500 CREATED)';
  RAISE NOTICE '  Notes    : 8000   (6000 finalized + AI summary / 2000 draft)';
  RAISE NOTICE '  Password : Password123!';
  RAISE NOTICE '═══════════════════════════════════════════';

END $$;
