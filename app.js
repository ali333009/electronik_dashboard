/* =========================================================
   لوحة تحكم إلكترونيك — app.js
   متصل بـ Firebase (Firestore + Auth + Storage)
   =========================================================
   الفهرس:
     1.  إعدادات Firebase + تهيئة
     2.  طبقة البيانات (Data Layer) — CRUD
     3.  أدوات مساعدة عامة (Helpers)
     4.  نظام المصادقة (Auth)
     5.  الـ Router + التنقل
     6.  الـ Sidebar
     7.  الـ Navbar + البحث السريع
     8.  صفحة Dashboard
     9.  صفحة المنتجات + رفع الصور
     10. صفحة الفئات
     11. صفحة الطلبات
     12. صفحة العملاء
     13. صفحة الكوبونات
     14. صفحة البانرات
     15. صفحة التقييمات
     16. صفحة الإشعارات
     17. صفحة الإعدادات
     18. دوال مساعدة إضافية
     19. تهيئة التطبيق
   ========================================================= */

/* =========================================================
   🔐 تحذير أمان Firestore — Firestore Security Rules Warning 🔐
   =========================================================
   ⚠️  هذه اللوحة تعتمد على Firebase Auth (onAuthStateChanged) 
   للتحقق من صلاحية الأدمن، لكن قواعد Firestore نفسها يجب أن
   تكون مقفولة بإحكام لضمان عدم وصول غير المصرح لهم للبيانات.
   
   ✅ القواعد الموصى بها في Firebase Console:
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       // القاعدة العامة: رفض الوصول ما لم يأذن به explicitly
       match /{document=**} {
         allow read, write: if false;
       }
       // السماح للأدمن فقط بقراءة وكتابة كل المجموعات
       match /{document=**} {
         allow read, write: if request.auth != null 
           && request.auth.token.isAdmin == true;
       }
       // السماح للمستخدمين العاديين بقراءة بياناتهم فقط
       match /users/{userId} {
         allow read, write: if request.auth != null 
           && request.auth.uid == userId;
       }
     }
   }
   
   ❗ يجب أيضاً إضافة custom claim isAdmin للمستخدمين عبر
   Firebase Admin SDK (وليس عبر Firestore فقط) لأن
   `request.auth.token.isAdmin` يعتمد على custom claims.
   استخدم Firebase Cloud Function لتحديد isAdmin كـ custom claim.
   ========================================================= */
'use strict';

/* =========================================================
   1) إعدادات Firebase + التهيئة
   ========================================================= */

const firebaseConfig = {
  apiKey: "AIzaSyBclpJtVGJOgEoKIgHH8FpqOZ61i-1I8D4",
  authDomain: "electronics-3c376.firebaseapp.com",
  projectId: "electronics-3c376",
  storageBucket: "electronics-3c376.firebasestorage.app",
  messagingSenderId: "156963900259",
  appId: "1:156963900259:web:609d3ddb1a1f80f1232156",
  measurementId: "G-GXY6LT53GZ"
};

// تهيئة Firebase
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const auth = firebase.auth();
const storage = firebase.storage();
const serverTS = () => firebase.firestore.FieldValue.serverTimestamp();

/* =========================================================
   إرسال الإشعارات عبر Firebase Cloud Function
   =========================================================
   ⚠️  FCM HTTP API لا يدعم CORS من المتصفح.
   الحل: استدعاء Cloud Function عبر httpsCallable() — 
   هي اللي ترسل FCM عبر Admin SDK بدون مشاكل CORS.
   =========================================================
   خطوة وحدة: انشر دالة sendNotification في functions/index.js
   (المحتوى موجود تحت في تعليق "كود الـ Cloud Function")
   ========================================================= */

/**
 * إرسال الإشعار أصبح يعتمد على Firestore Trigger (onNotificationCreated).
 * لا حاجة لاستدعاء دالة HTTP.
 */

/* =========================================================
   2) طبقة البيانات (Data Layer) — CRUD
     ========================================================= */

/**
 * قراءة جميع مستندات collection — يُفضّل استخدام listPaginated للمجموعات الكبيرة
 * @param {string} coll - اسم المجموعة
 * @returns {Promise<Array>}
 * 
 * يُوصى باستخدام listPaginated(coll, { limit, orderByField, startAfter })
 * للمجموعات الكبيرة (products, orders) لتجنب جلب جميع المستندات دفعة واحدة،
 * مما يقلل التكلفة وزمن الاستجابة.
 */
async function list(coll) {
  try {
    const snap = await db.collection(coll).get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) {
    throw wrapError(e);
  }
}

/**
 * قراءة مستندات collection مع pagination (server-side)
 * @param {string} coll - اسم المجموعة
 * @param {Object} opts - خيارات pagination
 * @param {number} opts.limit - عدد المستندات المطلوبة (default: 50)
 * @param {string} opts.orderByField - الحقل للترتيب (default: 'createdAt')
 * @param {*} opts.startAfter - آخر مستند معروف للبدء من بعده (document snapshot or field value)
 * @param {string} opts.direction - اتجاه الترتيب 'asc' أو 'desc' (default: 'desc')
 * @returns {Promise<{data: Array, lastDoc: any, hasMore: boolean}>}
 * 
 * مثال:
 *   const page1 = await listPaginated('products', { limit: 25 });
 *   const page2 = await listPaginated('products', { startAfter: page1.lastDoc, limit: 25 });
 */
async function listPaginated(coll, { limit = 50, orderByField = 'createdAt', startAfter = null, direction = 'desc' } = {}) {
  try {
    let query = db.collection(coll)
      .orderBy(orderByField, direction)
      .limit(limit);

    if (startAfter) {
      query = query.startAfter(startAfter);
    }

    const snap = await query.get();
    const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const lastDoc = snap.docs[snap.docs.length - 1] || null;
    const hasMore = snap.docs.length === limit;

    return { data, lastDoc, hasMore };
  } catch (e) {
    throw wrapError(e);
  }
}

/**
 * قراءة جميع المستخدمين (collection = 'users')
 * @returns {Promise<Array>}
 */
async function listUsers() {
  try {
    const snap = await db.collection('users').get();
    return snap.docs.map(d => ({ id: d.id, uid: d.id, ...d.data() }));
  } catch (e) {
    throw wrapError(e);
  }
}

/**
 * قراءة جميع التقييمات من كل المنتجات (collectionGroup)
 * @returns {Promise<Array>}
 */
async function listReviews() {
  try {
    const snap = await db.collectionGroup('reviews').get();
    return snap.docs.map(d => ({ id: d.id, _path: d.ref.path, ...d.data() }));
  } catch (e) {
    throw wrapError(e);
  }
}

/**
 * إضافة مستند جديد
 * @param {string} coll - اسم المجموعة
 * @param {Object} data - البيانات
 * @returns {Promise<string>} - معرّف المستند الجديد
 */
async function add(coll, data) {
  try {
    const ref = db.collection(coll).doc();
    await ref.set({
      id: ref.id,
      ...data,
      createdAt: serverTS(),
      updatedAt: serverTS(),
    });
    return ref.id;
  } catch (e) {
    throw wrapError(e);
  }
}

/**
 * إضافة مستند بمعرّف محدد
 * @param {string} coll - اسم المجموعة
 * @param {string} id - المعرّف
 * @param {Object} data - البيانات
 */
async function addWithId(coll, id, data) {
  try {
    await db.collection(coll).doc(id).set({
      id: id,
      ...data,
      createdAt: serverTS(),
      updatedAt: serverTS(),
    });
  } catch (e) {
    throw wrapError(e);
  }
}

/**
 * تحديث مستند
 * @param {string} coll - اسم المجموعة
 * @param {string} id - المعرّف
 * @param {Object} data - البيانات المُحدّثة
 */
async function update(coll, id, data) {
  try {
    await db.collection(coll).doc(id).update({
      id: id,
      ...data,
      updatedAt: serverTS(),
    });
  } catch (e) {
    throw wrapError(e);
  }
}

/**
 * حذف مستند
 * @param {string} coll - اسم المجموعة
 * @param {string} id - المعرّف
 */
async function remove(coll, id) {
  try {
    await db.collection(coll).doc(id).delete();
  } catch (e) {
    throw wrapError(e);
  }
}

/**
 * حذف تقييم (داخل subcollection)
 * @param {Object} rev - التقييم مع _path
 */
async function removeReview(rev) {
  try {
    await db.doc(rev._path).delete();
  } catch (e) {
    throw wrapError(e);
  }
}

/**
 * تحويل أخطاء Firebase إلى رسائل عربية واضحة
 */
function wrapError(e) {
  if (e.code === 'permission-denied') {
    return new Error('ليس لديك صلاحية. تأكد من أن حسابك أدمن (isAdmin: true في Firestore).');
  }
  if (e.code === 'unavailable') {
    return new Error('تعذّر الاتصال بـ Firebase. تحقق من الإنترنت.');
  }
  return e;
}

/* =========================================================
   ذاكرة مؤقتة للبيانات (Cache)
   ========================================================= */

const CACHE = {
  products: [],
  categories: [],
  orders: [],
  customers: [],
  banners: [],
  reviews: [],
  coupons: [],
  notifications: [],
  settings: {},
};

/**
 * تحميل كل البيانات من Firestore مرة واحدة
 * ملاحظة: المنتجات والطلبات يتم جلبها عبر listPaginated لتقليل التكلفة.
 * إذا كان العدد الكلي مطلوباً، استخدم list() العادية أو زِد limit.
 */
async function loadAllData() {
  const [productsRes, categories, ordersRes, customers, banners, reviews, coupons, settings, notifications] = await Promise.all([
    listPaginated('products', { limit: 999, orderByField: 'createdAt' }).catch(() => ({ data: [], lastDoc: null, hasMore: false })),
    list('categories').catch(() => []),
    listPaginated('orders', { limit: 999, orderByField: 'createdAt' }).catch(() => ({ data: [], lastDoc: null, hasMore: false })),
    listUsers().catch(() => []),
    list('banners').catch(() => []),
    listReviews().catch(() => []),
    list('promoCodes').catch(() => []),
    loadSettings().catch(() => ({})),
    list('notifications').catch(() => []),
  ]);
  const products = productsRes.data || [];
  const orders = ordersRes.data || [];
  Object.assign(CACHE, { products, categories, orders, customers, banners, reviews, coupons, settings, notifications });
  // تحذير في حال وجود بيانات أكثر من limit للـ pagination
  if (productsRes.hasMore) {
    console.warn('⚠️  توجد منتجات إضافية لم يتم تحميلها (أكثر من 999). استخدم listPaginated مع startAfter لجلب الباقي.');
  }
  if (ordersRes.hasMore) {
    console.warn('⚠️  توجد طلبات إضافية لم يتم تحميلها. استخدم listPaginated مع startAfter لجلب الباقي.');
  }
  // ترقية searchKeywords للمنتجات القديمة (حرف واحد)
  migrateSearchKeywords(products);
}

/**
 * تحميل إعدادات المتجر من collection `_meta/store_config`
 */
async function loadSettings() {
  const [storeSnap, shippingSnap] = await Promise.all([
    db.collection('_meta').doc('store_config').get(),
    db.collection('settings').doc('shipping').get(),
  ]);
  const store = storeSnap.exists ? storeSnap.data() : {};
  const shipping = shippingSnap.exists ? shippingSnap.data() : {};
  // دمج إعدادات الشحن من settings/shipping (المسار الذي يستخدمه Flutter)
  CACHE.settings = {
    ...store,
    shippingFee: shipping.shippingCost ?? store.shippingFee ?? 0,
    fastShippingFee: shipping.fastShippingCost ?? store.fastShippingFee ?? 40,
    freeShippingThreshold: shipping.freeShippingThreshold ?? store.freeShippingThreshold ?? 500,
    availableDaysCount: shipping.availableDaysCount ?? store.availableDaysCount ?? 3,
    normalDescription: shipping.normalDescription ?? store.normalDescription ?? 'توصيل خلال 3-5 أيام',
    expressDescription: shipping.expressDescription ?? store.expressDescription ?? 'توصيل خلال 24 ساعة',
    expressTimeSlots: shipping.expressTimeSlots ?? store.expressTimeSlots ?? [],
  };
  return CACHE.settings;
}

/* =========================================================
   3) أدوات مساعدة عامة (Helpers)
   ========================================================= */

/** اختصار لـ querySelector */
function $(sel, parent = document) { return parent.querySelector(sel); }

/** اختصار لـ querySelectorAll كمصفوفة */
function $$(sel, parent = document) { return Array.from(parent.querySelectorAll(sel)); }

/** Escape HTML لمنع XSS */
function esc(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
    .replace(/`/g, '&#96;');
}

/** تحويل Firestore Timestamp / ثواني / تاريخ إلى Date */
function toDate(v) {
  if (!v) return null;
  if (typeof v.toDate === 'function') return v.toDate();
  if (v.seconds) return new Date(v.seconds * 1000);
  return new Date(v);
}

/** تنسيق الأرقام بأرقام إنجليزية */
function formatNumber(n) {
  if (n === null || n === undefined || isNaN(n)) return '0';
  return Number(n).toLocaleString('en-US');
}

/** تنسيق العملة (دينار كويتي افتراضيًا) */
function formatCurrency(amount, currency = 'KD') {
  if (amount === null || amount === undefined || isNaN(amount)) return `0 ${currency}`;
  return `${Number(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

/** استخراج الحروف الأولى من الاسم */
function getInitials(name) {
  if (!name || typeof name !== 'string') return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return parts[0].charAt(0).toUpperCase() + parts[parts.length - 1].charAt(0).toUpperCase();
}

/** قص كود الدولة من رقم الهاتف */
function normalizePhone(phone) {
  if (!phone || typeof phone !== 'string') return phone || '';
  let p = phone.trim().replace(/[\s\-()]/g, '');
  if (p.startsWith('00')) p = '+' + p.slice(2);
  if (!p.startsWith('+')) return p;
  const codes = ['+966', '+971', '+974', '+973', '+965', '+968', '+962', '+961', '+963', '+967', '+970', '+972', '+218', '+216', '+213', '+212', '+222', '+249', '+252', '+253', '+20'];
  for (const code of codes) { if (p.startsWith(code)) return '0' + p.slice(code.length); }
  return phone.trim();
}

/** تنسيق التاريخ */
function formatDate(date, withTime = false) {
  const d = toDate(date);
  if (!d || isNaN(d.getTime())) return '—';
  const opts = { year: 'numeric', month: 'short', day: 'numeric' };
  if (withTime) { opts.hour = '2-digit'; opts.minute = '2-digit'; }
  return d.toLocaleDateString('ar-EG-u-nu-latn', opts);
}

/** الوقت النسبي (منذ كذا) */
function timeAgo(date) {
  const d = toDate(date);
  if (!d) return '—';
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return 'الآن';
  const m = Math.floor(s / 60); if (m < 60) return `منذ ${m} دقيقة`;
  const h = Math.floor(m / 60); if (h < 24) return `منذ ${h} ساعة`;
  const d2 = Math.floor(h / 24); if (d2 < 30) return `منذ ${d2} يوم`;
  const mo = Math.floor(d2 / 30); if (mo < 12) return `منذ ${mo} شهر`;
  return `منذ ${Math.floor(mo / 12)} سنة`;
}

/** تنسيق حجم الملف */
function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

/**
 * تطبيع النص العربي للبحث المرن
 * - توحيد الهمزات (أ/إ/آ → ا)
 * - توحيد التاء المربوطة (ة → هـ)
 * - توحيد الألف المقصورة (ى → ي)
 * - إزالة التشكيل
 * - إزالة لاحقات الجمع (ات/ون/ين/ة/هـ/ت) من نهاية كل كلمة
 * - إزالة "ال" التعريف
 */
function normalizeArabic(text) {
  if (!text) return '';
  return String(text)
    .replace(/[\u064B-\u065F\u0670]/g, '')   // التشكيل
    .replace(/[أإآ]/g, 'ا')                    // الهمزات
    .replace(/ة/g, 'ه')                        // التاء المربوطة
    .replace(/ى/g, 'ي')                        // الألف المقصورة
    .replace(/\s+/g, ' ').trim()
    .split(' ')
    .map(word => {
      if (word.length <= 3) return word;
      return word
        .replace(/(يات|ات|ون|ين)$/g, '')       // جمع
        .replace(/(اه|وه)$/g, '')              // لاحقات نادرة
        .replace(/ه$/g, '')                    // تاء مربوطة مطبَّعة
        .replace(/ت$/g, '')                    // تاء مفتوحة
        .replace(/^(ال)/g, '');                // "ال" التعريف
    })
    .join(' ')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * بحث عربي مرن
 * @param {string} haystack - النص المراد البحث فيه
 * @param {string} needle - كلمة البحث
 * @returns {boolean}
 */
function arabicSearch(haystack, needle) {
  if (!needle) return true;
  const h = normalizeArabic(haystack);
  const n = normalizeArabic(needle);
  if (!n) return true;
  if (!h) return false;
  if (h.includes(n)) return true;
  const words = n.split(' ').filter(w => w.length > 0);
  if (words.length > 1) return words.some(w => h.includes(w));
  const haystackWords = h.split(' ').filter(w => w.length > 0);
  return haystackWords.some(w => w.startsWith(n) || w.includes(n));
}

/**
 * توليد searchKeywords للبحث الذكي في تطبيق Flutter
 */
function generateSearchKeywords(nameAr = '', nameEn = '') {
  const keywords = new Set();
  if (nameAr) keywords.add(nameAr.toLowerCase().trim());
  if (nameEn) keywords.add(nameEn.toLowerCase().trim());
  (nameAr || '').split(/\s+/).forEach(w => { if (w.length > 1) keywords.add(w.toLowerCase()); });
  (nameEn || '').split(/\s+/).forEach(w => { if (w.length > 1) keywords.add(w.toLowerCase()); });
  return [...keywords].filter(Boolean);
}

/** تقطيع أول كلمتين من النص لكل الاحتمالات (مثال: علي محمد ← ع, عل, علي, ل, لي, ي, م, مح, محم, محمد, ح, حم, حمد, م, مد, د) */
function expandToAllSubstrings(words) {
  const result = new Set();
  (words || '').split(/\s+/).filter(Boolean).slice(0, 2).forEach(w => {
    const lower = w.toLowerCase();
    for (let i = 0; i < lower.length; i++) {
      for (let j = i + 1; j <= lower.length; j++) {
        result.add(lower.substring(i, j));
      }
    }
  });
  return [...result];
}

/** ترقية searchKeywords لجميع المنتجات بشكل إجباري (Force Update) */
async function migrateSearchKeywords(products) {
  for (const p of products) {
    const expected = [...new Set([
      ...generateSearchKeywords(p.nameAr, p.nameEn),
      ...expandToAllSubstrings(p.nameAr || ''),
      ...expandToAllSubstrings(p.nameEn || ''),
    ])];
    const current = p.searchKeywords || [];
    // مقارنة صحيحة بغض النظر عن الترتيب
    const currentSet = new Set(current);
    const expectedSet = new Set(expected);
    const needsUpdate = currentSet.size !== expectedSet.size ||
      [...expectedSet].some(k => !currentSet.has(k));
    if (needsUpdate) {
      try {
        await db.collection('products').doc(p.id).update({ searchKeywords: expected });
        p.searchKeywords = expected;
      } catch (e) { console.warn('تجاهل منتج:', p.id, e.message); }
    }
  }
}


/** عرض إشعار Toast */
function showToast(message, type = 'info', duration = 3500) {
  const container = $('#toast-container');
  if (!container) { alert(message); return; }
  const iconMap = {
    success: 'bi-check-circle-fill',
    error: 'bi-x-circle-fill',
    warning: 'bi-exclamation-triangle-fill',
    info: 'bi-info-circle-fill',
  };
  const titleMap = { success: 'تم بنجاح', error: 'خطأ', warning: 'تنبيه', info: 'معلومة' };
  const el = document.createElement('div');
  el.className = `toast toast-${type} show`;
  el.setAttribute('role', 'alert');
  el.innerHTML = `
    <div class="toast-header">
      <i class="bi ${iconMap[type]} me-2"></i>
      <strong class="me-auto">${titleMap[type]}</strong>
      <small class="text-muted">${new Date().toLocaleTimeString('ar-EG-u-nu-latn', { hour: '2-digit', minute: '2-digit' })}</small>
      <button type="button" class="btn-close btn-close-white me-0" aria-label="إغلاق"></button>
    </div>
    <div class="toast-body">${esc(message)}</div>
  `;
  el.querySelector('.btn-close').addEventListener('click', () => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 300);
  });
  container.appendChild(el);
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 300);
  }, duration);
}

/** Modal تأكيد العملية (يُرجع Promise<boolean>) */
function confirmAction(message = 'هل أنت متأكد؟', title = 'تأكيد العملية', confirmText = 'تأكيد', confirmType = 'danger') {
  return new Promise((resolve) => {
    const modalId = 'confirm-modal-' + Date.now() + '-' + Math.random().toString(36).substring(2, 8);
    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <div class="modal fade" id="${modalId}" tabindex="-1">
        <div class="modal-dialog modal-dialog-centered">
          <div class="modal-content">
            <div class="modal-header">
              <h5 class="modal-title"><i class="bi bi-exclamation-triangle text-warning me-2"></i>${esc(title)}</h5>
              <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
            </div>
            <div class="modal-body"><p class="mb-0">${esc(message)}</p></div>
            <div class="modal-footer">
              <button type="button" class="btn btn-light" data-bs-dismiss="modal">إلغاء</button>
              <button type="button" class="btn btn-${confirmType}" id="${modalId}-ok">${esc(confirmText)}</button>
            </div>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(wrap);
    const modal = new bootstrap.Modal(wrap.querySelector('.modal'));
    let resolved = false;
    modal.show();
    wrap.querySelector(`#${modalId}-ok`).addEventListener('click', () => {
      resolved = true;
      modal.hide();
      resolve(true);
    });
    wrap.querySelector('.modal').addEventListener('hidden.bs.modal', () => {
      wrap.remove();
      if (!resolved) resolve(false);
    });
  });
}

/** جمع بيانات النموذج في كائن */
function getFormData(form) {
  const data = {};
  form.querySelectorAll('input, select, textarea').forEach(el => {
    if (!el.name) return;
    if (el.type === 'checkbox') data[el.name] = el.checked;
    else if (el.type === 'radio') { if (el.checked) data[el.name] = el.value; }
    else if (el.type === 'number') data[el.name] = el.value === '' ? null : Number(el.value);
    else if (el.type !== 'file') data[el.name] = el.value;
  });
  return data;
}

/** ملء النموذج بقيم */
function setFormData(form, data) {
  form.querySelectorAll('input, select, textarea').forEach(el => {
    if (!el.name || !(el.name in data)) return;
    if (el.type === 'checkbox') el.checked = !!data[el.name];
    else if (el.type === 'radio') el.checked = String(el.value) === String(data[el.name]);
    else if (el.type === 'date' && data[el.name]) {
      const d = toDate(data[el.name]);
      el.value = d ? d.toISOString().split('T')[0] : '';
    } else el.value = data[el.name] ?? '';
  });
}

/** فتح Modal عام */
function openModal({ id, title, bodyHTML, submitText = 'حفظ', submitType = 'primary', large = false, onSubmit = null, onShown = null, onHidden = null, cancelText = 'إلغاء' }) {
  closeModal(id);
  const container = $('#modal-container');
  if (!container) return;
  const html = `
    <div class="modal fade" id="${id}" tabindex="-1">
      <div class="modal-dialog ${large ? 'modal-lg' : ''} modal-dialog-centered modal-dialog-scrollable">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">${title}</h5>
            <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
          </div>
          <div class="modal-body">${bodyHTML}</div>
          <div class="modal-footer">
            <button type="button" class="btn btn-light" data-bs-dismiss="modal">${cancelText}</button>
            ${onSubmit ? `<button type="button" class="btn btn-${submitType}" id="${id}-submit"><span class="btn-text">${submitText}</span><span class="spinner-border spinner-border-sm d-none"></span></button>` : ''}
          </div>
        </div>
      </div>
    </div>
  `;
  container.insertAdjacentHTML('beforeend', html);
  const modalEl = container.querySelector(`#${id}`);
  const modal = new bootstrap.Modal(modalEl);
  modalEl.addEventListener('shown.bs.modal', () => { if (onShown) onShown(modalEl); });
  modalEl.addEventListener('hidden.bs.modal', () => {
    modalEl.remove();
    if (document.querySelectorAll('.modal.show').length > 0) {
      document.body.classList.add('modal-open');
    }
    if (onHidden) onHidden();
  });
  if (onSubmit) {
    const btn = modalEl.querySelector(`#${id}-submit`);
    btn.addEventListener('click', async () => {
      const txt = btn.querySelector('.btn-text');
      const sp = btn.querySelector('.spinner-border');
      txt.classList.add('d-none');
      sp.classList.remove('d-none');
      btn.disabled = true;
      try {
        const result = await onSubmit(modalEl);
        if (result !== false) modal.hide();
      } catch (e) {
        console.error('[Modal] خطأ:', e);
        showToast(e.message || 'خطأ', 'error');
      } finally {
        txt.classList.remove('d-none');
        sp.classList.add('d-none');
        btn.disabled = false;
      }
    });
  }
  modal.show();
}

/** إغلاق Modal */
function closeModal(id) {
  const el = document.getElementById(id);
  if (el) {
    const m = bootstrap.Modal.getInstance(el);
    if (m) m.hide();
    else el.remove();
  }
}

/** تصدير البيانات إلى CSV */
function exportToCSV(items, columns, filename = 'export.csv') {
  if (!items || items.length === 0) { showToast('لا توجد بيانات للتصدير', 'error'); return; }
  const header = columns.map(c => `"${c.label}"`).join(',');
  const rows = items.map(item => {
    return columns.map(c => {
      let val = typeof c.value === 'function' ? c.value(item) : (item[c.value] ?? '');
      val = String(val).replace(/"/g, '""');
      return `"${val}"`;
    }).join(',');
  }).join('\n');
  const bom = '\uFEFF';
  const blob = new Blob([bom + header + '\n' + rows], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename.replace(/\.csv$/, '') + '.csv';
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
  showToast(`تم تصدير ${items.length} سجل بنجاح`, 'success');
}

/* =========================================================
   4) نظام المصادقة (Auth)
   ========================================================= */

let currentAdmin = null;

/**
 * تسجيل الدخول + التحقق من صلاحية الأدمن
 */
async function login(email, password) {
  const cred = await auth.signInWithEmailAndPassword(email, password);
  const snap = await db.collection('users').doc(cred.user.uid).get();
  const d = snap.exists ? snap.data() : {};
  if (!(d.isAdmin === true || d.role === 'admin')) {
    await auth.signOut();
    throw new Error('هذا الحساب ليس لديه صلاحية أدمن');
  }
  currentAdmin = {
    uid: cred.user.uid,
    email: cred.user.email,
    displayName: d.displayName || d.email || email,
  };
  await startDashboard();
}

/** تسجيل الخروج */
function logout() {
  auth.signOut().then(() => {
    currentAdmin = null;
    location.reload();
  });
}

/** عرض شاشة تسجيل الدخول */
function showLoginView() {
  const pre = $('#preloader');
  if (pre) {
    pre.classList.add('hidden');
    pre.style.display = 'none';
  }
  $('#login-view')?.classList.remove('d-none');
  $('#app-shell')?.classList.add('d-none');
  attachLoginEvents();
}

/** ربط أحداث نموذج الدخول */
function attachLoginEvents() {
  const form = $('#login-form');
  if (!form || form.dataset.attached === 'true') return;
  form.dataset.attached = 'true';

  $('#toggle-password').addEventListener('click', () => {
    const inp = $('#login-password');
    const isPw = inp.type === 'password';
    inp.type = isPw ? 'text' : 'password';
    $('#toggle-password i').className = isPw ? 'bi bi-eye-slash' : 'bi bi-eye';
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $('#login-email').value.trim();
    const password = $('#login-password').value;
    const errBox = $('#login-error');
    const btn = $('#login-btn');
    const txt = btn.querySelector('.btn-text');
    const sp = btn.querySelector('.spinner-border');

    txt.textContent = 'جاري التحقق...';
    sp.classList.remove('d-none');
    btn.disabled = true;
    errBox.classList.add('d-none');

    try {
      await login(email, password);
      showToast('مرحبًا بك في لوحة التحكم', 'success');
    } catch (error) {
      console.error('[Login] خطأ:', error);
      const map = {
        'auth/invalid-email': 'البريد الإلكتروني غير صالح',
        'auth/user-disabled': 'تم تعطيل هذا الحساب',
        'auth/user-not-found': 'لا يوجد حساب بهذا البريد',
        'auth/wrong-password': 'كلمة المرور غير صحيحة',
        'auth/invalid-credential': 'بيانات الدخول غير صحيحة',
        'auth/too-many-requests': 'محاولات كثيرة فاشلة. حاول لاحقًا',
        'auth/network-request-failed': 'تعذّر الاتصال بالخادم',
        'auth/configuration-not-found': 'إعدادات Firebase غير مكتملة',
        'auth/api-key-not-valid': 'مفتاح Firebase API غير صالح',
        'auth/api-key-not-valid.-please-pass-a-valid-api-key.': 'مفتاح Firebase API غير صالح',
        'auth/unauthorized-domain': 'هذا النطاق غير مصرّح به في Firebase Console',
        'auth/operation-not-allowed': 'طريقة تسجيل الدخول غير مفعّلة في Firebase Console',
      };
      const msg = (error.code && map[error.code]) || error.message || 'تعذّر تسجيل الدخول';
      errBox.textContent = msg;
      errBox.classList.remove('d-none');
    } finally {
      txt.textContent = 'تسجيل الدخول';
      sp.classList.add('d-none');
      btn.disabled = false;
    }
  });
}

/** بدء لوحة التحكم بعد التحقق */
async function startDashboard() {
  $('#login-view')?.classList.add('d-none');
  const pre = $('#preloader');
  if (pre) {
    pre.classList.remove('hidden');
    pre.style.display = 'flex';
  }
  try {
    await loadAllData();
  } catch (e) {
    console.error('[loadAllData] خطأ:', e);
    showToast('تعذّر تحميل البيانات: ' + e.message, 'error');
  }
  if (pre) {
    pre.classList.add('hidden');
    setTimeout(() => pre.remove(), 400);
  }
  $('#app-shell')?.classList.remove('d-none');
  renderSidebar();
  renderNavbar();
  const hash = window.location.hash.replace(/^#\/?/, '') || 'dashboard';
  const routeName = hash.split('/')[0];
  navigate(ROUTES[routeName] ? routeName : 'dashboard');
}

/* =========================================================
   5) الـ Router + التنقل
   ========================================================= */

const ROUTES = {};
let currentRoute = 'dashboard';

function registerRoute(name, render) { ROUTES[name] = render; }

/** التنقل بين الصفحات */
function navigate(route) {
  if (!ROUTES[route]) route = 'dashboard';
  if (window.innerWidth < 992) closeSidebar();
  currentRoute = route;
  if (window.location.hash !== `#/${route}`) window.location.hash = `#/${route}`;
  highlightActiveNav(route);
  updateNavbarTitle(route);
  const main = $('#main-content');
  main.innerHTML = `<div class="empty-state"><div class="spinner-border text-primary"></div><p class="mt-3">جاري التحميل...</p></div>`;
  window.scrollTo({ top: 0, behavior: 'smooth' });
  try {
    ROUTES[route](main);
    main.classList.remove('view-enter');
    void main.offsetWidth;
    main.classList.add('view-enter');
  } catch (e) {
    console.error('[Router] خطأ:', e);
    main.innerHTML = `<div class="empty-state"><i class="bi bi-exclamation-triangle text-danger"></i><h5>خطأ في التحميل</h5><p>${esc(e.message)}</p></div>`;
  }
}

/** معالج تغيير الـ hash */
function handleHashChange() {
  const hash = window.location.hash.replace(/^#\/?/, '') || 'dashboard';
  const routeName = hash.split('/')[0];
  if (ROUTES[routeName] && routeName !== currentRoute) navigate(routeName);
  else if (!ROUTES[routeName]) navigate('dashboard');
}

/* =========================================================
   6) الـ Sidebar
   ========================================================= */

const NAV_ITEMS = [
  {
    section: 'الرئيسية', items: [
      { route: 'dashboard', label: 'الرئيسية', icon: 'bi-grid-1x2-fill' },
    ]
  },
  {
    section: 'إدارة المتجر', items: [
      { route: 'products', label: 'المنتجات', icon: 'bi-box-seam' },
      { route: 'categories', label: 'الفئات', icon: 'bi-tags' },
      { route: 'orders', label: 'الطلبات', icon: 'bi-bag-check' },
      { route: 'customers', label: 'العملاء', icon: 'bi-people' },
    ]
  },
  {
    section: 'التسويق', items: [
      { route: 'coupons', label: 'الكوبونات', icon: 'bi-ticket-perforated' },
      { route: 'banners', label: 'البانرات', icon: 'bi-card-image' },
      { route: 'reviews', label: 'التقييمات', icon: 'bi-star' },
      { route: 'notifications', label: 'الإشعارات', icon: 'bi-bell' },
    ]
  },
  {
    section: 'النظام', items: [
      { route: 'settings', label: 'الإعدادات', icon: 'bi-gear' },
    ]
  },
];

/** رسم الـ Sidebar */
function renderSidebar() {
  const sb = $('#sidebar');
  const initials = (currentAdmin?.displayName || currentAdmin?.email || 'AD').substring(0, 2).toUpperCase();
  sb.innerHTML = `
    <div class="sidebar-header">
      <div class="sidebar-logo"><i class="bi bi-bag-check-fill"></i></div>
      <div>
        <h2 class="sidebar-title">إلكترونيك</h2>
        <p class="sidebar-subtitle">لوحة التحكم</p>
      </div>
    </div>
    <nav class="sidebar-nav">
      ${NAV_ITEMS.map(s => `
        <div class="nav-section-title">${s.section}</div>
        ${s.items.map(i => `
          <a class="nav-item-link" data-route="${i.route}" href="#/${i.route}">
            <i class="bi ${i.icon}"></i>
            <span class="nav-label">${i.label}</span>
          </a>
        `).join('')}
      `).join('')}
    </nav>
    <div class="sidebar-footer">
      <div class="user-card">
        <div class="user-avatar">${esc(initials)}</div>
        <div class="user-info">
          <p class="user-name">${esc(currentAdmin?.displayName || 'مدير عام')}</p>
          <p class="user-role">${esc(currentAdmin?.email || '')}</p>
        </div>
        <button class="btn-logout" id="btn-logout" title="تسجيل الخروج">
          <i class="bi bi-box-arrow-right"></i>
        </button>
      </div>
    </div>
  `;
  $$('#sidebar .nav-item-link').forEach(a => {
    a.addEventListener('click', e => {
      e.preventDefault();
      navigate(a.dataset.route);
      if (window.innerWidth < 992) closeSidebar();
    });
  });
  $('#btn-logout').addEventListener('click', async () => {
    const ok = await confirmAction('هل تريد تسجيل الخروج؟', 'تسجيل الخروج', 'خروج', 'danger');
    if (ok) logout();
  });
}

/** إبراز العنصر النشط */
function highlightActiveNav(route) {
  $$('#sidebar .nav-item-link').forEach(a => a.classList.toggle('active', a.dataset.route === route));
}

/** فتح/إغلاق الـ Sidebar (موبايل) */
function openSidebar() {
  $('#sidebar').classList.add('show');
  $('#sidebar-overlay').classList.add('show');
  document.body.classList.add('sidebar-open');
}
function closeSidebar() {
  $('#sidebar').classList.remove('show');
  $('#sidebar-overlay').classList.remove('show');
  document.body.classList.remove('sidebar-open');
}

/* =========================================================
   7) الـ Navbar + البحث السريع
   ========================================================= */

const ROUTE_TITLES = {
  dashboard: { title: 'الرئيسية', subtitle: 'نظرة عامة على أداء متجر إلكترونيك' },
  products: { title: 'المنتجات', subtitle: 'إدارة منتجات متجر إلكترونيك' },
  categories: { title: 'الفئات', subtitle: 'إدارة فئات المنتجات' },
  orders: { title: 'الطلبات', subtitle: 'متابعة وإدارة طلبات العملاء' },
  customers: { title: 'العملاء', subtitle: 'إدارة حسابات العملاء' },
  coupons: { title: 'الكوبونات', subtitle: 'إدارة أكواد الخصم والعروض' },
  banners: { title: 'البانرات', subtitle: 'إدارة بانرات المتجر' },
  reviews: { title: 'التقييمات', subtitle: 'مراجعة تقييمات المنتجات' },
  notifications: { title: 'الإشعارات', subtitle: 'إرسال إشعارات للمستخدمين' },
  settings: { title: 'الإعدادات', subtitle: 'إعدادات المتجر العامة' },
};

/** رسم الـ Navbar */
function renderNavbar() {
  const initials = (currentAdmin?.displayName || currentAdmin?.email || 'AD').substring(0, 2).toUpperCase();
  $('#navbar').innerHTML = `
    <button class="btn-sidebar-toggle d-lg-none" id="btn-toggle-sidebar"><i class="bi bi-list"></i></button>
    <div class="d-none d-md-block">
      <h1 class="page-title" id="navbar-page-title">الرئيسية</h1>
      <p class="page-subtitle" id="navbar-page-subtitle">نظرة عامة على أداء متجر إلكترونيك</p>
    </div>
    <div class="navbar-search d-none d-lg-block">
      <i class="bi bi-search"></i>
      <input type="text" id="navbar-search-input" placeholder="ابحث سريعًا عن منتج، طلب، عميل، كوبون..." autocomplete="off" />
      <div class="search-results-dropdown" id="search-dropdown"></div>
    </div>
    <div class="navbar-actions">
      <button class="nav-icon-btn" title="الإشعارات" id="nav-notifications"><i class="bi bi-bell"></i><span class="badge-dot"></span></button>
      <button class="nav-icon-btn" title="الطلبات"   id="nav-orders"><i class="bi bi-bag-check"></i></button>
      <button class="nav-icon-btn" title="إعادة تحميل" id="nav-refresh"><i class="bi bi-arrow-clockwise"></i></button>
      <div class="divider-y d-none d-md-block" style="width:1px;background:var(--border-color);align-self:stretch;margin:0 0.25rem;"></div>
      <div class="nav-user">
        <div class="user-avatar-sm">${esc(initials)}</div>
        <div class="user-meta d-none d-md-flex">
          <span>${esc(currentAdmin?.displayName || 'مدير عام')}</span>
          <span>إلكترونيك</span>
        </div>
      </div>
    </div>
  `;
  $('#btn-toggle-sidebar').addEventListener('click', () => {
    if ($('#sidebar').classList.contains('show')) closeSidebar(); else openSidebar();
  });
  $('#sidebar-overlay').addEventListener('click', closeSidebar);
  $('#nav-notifications').addEventListener('click', () => navigate('notifications'));
  $('#nav-orders').addEventListener('click', () => navigate('orders'));
  $('#nav-refresh').addEventListener('click', async () => {
    const btn = $('#nav-refresh');
    btn.classList.add('rotating');
    btn.disabled = true;
    await loadAllData();
    navigate(currentRoute);
    btn.disabled = false;
    btn.classList.remove('rotating');
  });
  setupQuickSearch();
}

/** تحديث عنوان الصفحة */
function updateNavbarTitle(route) {
  const info = ROUTE_TITLES[route] || { title: 'لوحة التحكم', subtitle: '' };
  const t = $('#navbar-page-title');
  const s = $('#navbar-page-subtitle');
  if (t) t.textContent = info.title;
  if (s) s.textContent = info.subtitle;
  document.title = `${info.title} - إلكترونيك`;
}

/** تهيئة البحث السريع */
function setupQuickSearch() {
  const input = $('#navbar-search-input');
  const dropdown = $('#search-dropdown');
  if (!input || !dropdown) return;
  // منع إضافة الـ document listener أكثر من مرة
  if (document._quickSearchInitialized) {
    attachQuickSearchInput(input, dropdown);
    return;
  }
  document._quickSearchInitialized = true;
  // إغلاق القائمة عند النقر خارجها (مرة واحدة)
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.navbar-search')) {
      const dd = $('#search-dropdown');
      if (dd) dd.classList.remove('show');
    }
  });
  attachQuickSearchInput(input, dropdown);
}

function attachQuickSearchInput(input, dropdown) {
  let debounceTimer;
  input.addEventListener('input', (e) => {
    clearTimeout(debounceTimer);
    const query = e.target.value.trim();
    if (!query) {
      dropdown.classList.remove('show');
      dropdown.innerHTML = '';
      return;
    }
    debounceTimer = setTimeout(() => performQuickSearch(query, dropdown), 250);
  });
  input.addEventListener('focus', () => {
    if (input.value.trim()) performQuickSearch(input.value.trim(), dropdown);
  });
  input.addEventListener('keydown', (e) => {
    const items = dropdown.querySelectorAll('.sr-item');
    if (!items.length) return;
    const current = dropdown.querySelector('.sr-item.active');
    let idx = current ? Array.from(items).indexOf(current) : -1;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      idx = (idx + 1) % items.length;
      items.forEach(i => i.classList.remove('active'));
      items[idx].classList.add('active');
      items[idx].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      idx = idx <= 0 ? items.length - 1 : idx - 1;
      items.forEach(i => i.classList.remove('active'));
      items[idx].classList.add('active');
      items[idx].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (current) current.click();
      else if (items.length > 0) items[0].click();
    } else if (e.key === 'Escape') {
      dropdown.classList.remove('show');
      input.blur();
    }
  });
}

/** تنفيذ البحث السريع وعرض النتائج */
function performQuickSearch(query, dropdown) {
  const results = [];
  const q = query;

  // المنتجات
  const products = (CACHE.products || []).filter(p =>
    arabicSearch(p.nameAr, q) || arabicSearch(p.nameEn, q) ||
    arabicSearch(p.descriptionAr, q)
  ).slice(0, 5);
  if (products.length > 0) {
    results.push({ type: 'section', title: 'المنتجات' });
    products.forEach(p => {
      results.push({
        type: 'item',
        icon: 'bi-box-seam', iconColor: 'var(--color-accent)', iconBg: 'var(--color-accent-soft)',
        title: p.nameAr || p.nameEn || '—',
        subtitle: `${formatCurrency(p.price)}${p.originalPrice && p.originalPrice > p.price ? ` (كان ${formatCurrency(p.originalPrice)})` : ''} | مخزون: ${p.stockQuantity || 0}`,
        image: p.images && p.images[0],
        action: () => { navigate('products'); closeSearchDropdown(); },
      });
    });
  }

  // الطلبات
  const orders = (CACHE.orders || []).filter(o => {
    const custName = o.shippingAddress?.name || '';
    return arabicSearch(o.id, q) || arabicSearch(custName, q) || arabicSearch(o.shippingAddress?.city, q);
  }).slice(0, 5);
  if (orders.length > 0) {
    results.push({ type: 'section', title: 'الطلبات' });
    orders.forEach(o => {
      const custName = o.shippingAddress?.name || 'عميل';
      const statusLabels = { ordered: 'تم الطلب', pending: 'قيد المعالجة', delivered: 'تم التوصيل', cancelled: 'ملغي' };
      results.push({
        type: 'item',
        icon: 'bi-bag-check', iconColor: 'var(--color-success)', iconBg: 'var(--color-success-soft)',
        title: `#${o.id.substring(0, 8)} - ${custName}`,
        subtitle: `${formatCurrency(o.total)} | ${statusLabels[o.status] || o.status}`,
        action: () => { navigate('orders'); closeSearchDropdown(); },
      });
    });
  }

  // العملاء
  const customers = (CACHE.customers || []).filter(c =>
    arabicSearch(c.displayName, q) || arabicSearch(c.email, q) ||
    arabicSearch(c.phone, q) || arabicSearch(c.phoneNumber, q) ||
    arabicSearch(normalizePhone(c.phone || ''), q)
  ).slice(0, 5);
  if (customers.length > 0) {
    results.push({ type: 'section', title: 'العملاء' });
    customers.forEach(c => {
      results.push({
        type: 'item',
        icon: 'bi-person', iconColor: 'var(--color-info)', iconBg: 'var(--color-info-soft)',
        title: c.displayName || '—',
        subtitle: `${c.email || '—'} | ${normalizePhone(c.phone || c.phoneNumber) || '—'}`,
        action: () => { navigate('customers'); closeSearchDropdown(); },
      });
    });
  }

  // الكوبونات
  const coupons = (CACHE.coupons || []).filter(c => arabicSearch(c.id, q)).slice(0, 5);
  if (coupons.length > 0) {
    results.push({ type: 'section', title: 'الكوبونات' });
    coupons.forEach(c => {
      results.push({
        type: 'item',
        icon: 'bi-ticket-perforated', iconColor: 'var(--color-warning)', iconBg: 'var(--color-warning-soft)',
        title: c.id,
        subtitle: `خصم ${c.discountPercent}% | ${c.isActive !== false ? 'مفعّل' : 'معطّل'}`,
        action: () => { navigate('coupons'); closeSearchDropdown(); },
      });
    });
  }

  // الفئات
  const categories = (CACHE.categories || []).filter(c =>
    arabicSearch(c.nameAr, q) || arabicSearch(c.nameEn, q)
  ).slice(0, 5);
  if (categories.length > 0) {
    results.push({ type: 'section', title: 'الفئات' });
    categories.forEach(c => {
      results.push({
        type: 'item',
        icon: 'bi-tags', iconColor: 'var(--color-accent)', iconBg: 'var(--color-accent-soft)',
        title: c.nameAr || c.nameEn || '—',
        subtitle: c.nameEn || '',
        image: c.imageUrl,
        action: () => { navigate('categories'); closeSearchDropdown(); },
      });
    });
  }

  // البانرات
  const banners = (CACHE.banners || []).filter(b =>
    arabicSearch(b.titleAr, q) || arabicSearch(b.titleEn, q) || arabicSearch(b.subtitleAr, q)
  ).slice(0, 5);
  if (banners.length > 0) {
    results.push({ type: 'section', title: 'البانرات' });
    banners.forEach(b => {
      results.push({
        type: 'item',
        icon: 'bi-card-image', iconColor: 'var(--color-danger)', iconBg: 'var(--color-danger-soft)',
        title: b.titleAr || b.titleEn || '—',
        subtitle: b.subtitleAr || '',
        image: b.imageUrl,
        action: () => { navigate('banners'); closeSearchDropdown(); },
      });
    });
  }

  // عرض النتائج
  if (results.length === 0) {
    dropdown.innerHTML = `
      <div class="sr-empty">
        <i class="bi bi-search"></i>
        <div>لا توجد نتائج لـ "${esc(query)}"</div>
      </div>
    `;
  } else {
    dropdown.innerHTML = results.map(r => {
      if (r.type === 'section') return `<div class="sr-section-title">${esc(r.title)}</div>`;
      const imageHtml = r.image
        ? `<div class="sr-icon" style="background: var(--bg-input); padding: 0; overflow: hidden;"><img src="${esc(r.image)}" style="width:100%; height:100%; object-fit: cover;" alt="" /></div>`
        : `<div class="sr-icon" style="background: ${r.iconBg}; color: ${r.iconColor};"><i class="bi ${r.icon}"></i></div>`;
      return `
        <div class="sr-item" data-idx="${results.indexOf(r)}">
          ${imageHtml}
          <div class="sr-info">
            <div class="sr-title">${esc(r.title)}</div>
            ${r.subtitle ? `<div class="sr-subtitle">${esc(r.subtitle)}</div>` : ''}
          </div>
        </div>
      `;
    }).join('');
    dropdown.querySelectorAll('.sr-item').forEach(el => {
      const idx = parseInt(el.dataset.idx);
      const item = results[idx];
      el.addEventListener('click', () => item.action());
    });
  }
  dropdown.classList.add('show');
}

/** إغلاق قائمة البحث السريع */
function closeSearchDropdown() {
  const dropdown = $('#search-dropdown');
  const input = $('#navbar-search-input');
  if (dropdown) dropdown.classList.remove('show');
  if (input) input.value = '';
}

/* =========================================================
   8) صفحة Dashboard
   ========================================================= */

/** Badge حالة الطلب */
function getStatusBadge(status) {
  const map = {
    ordered: '<span class="badge bg-secondary-soft">تم الطلب</span>',
    pending: '<span class="badge bg-accent-soft">قيد المعالجة</span>',
    delivered: '<span class="badge bg-success-soft">تم التوصيل</span>',
    cancelled: '<span class="badge bg-danger-soft">ملغي</span>',
  };
  return map[status] || '<span class="badge bg-secondary-soft">غير معروف</span>';
}

/** نص طريقة الدفع */
function getPaymentMethodBadge(method) {
  const map = { cod: 'الدفع عند الاستلام', card: 'بطاقة', wallet: 'محفظة' };
  return map[method] || method || '—';
}

function renderDashboard(container) {
  const totalSales = CACHE.orders
    .filter(o => o.status === 'delivered')
    .reduce((s, o) => s + Number(o.total || 0), 0);
  const recentOrders = [...CACHE.orders]
    .sort((a, b) => (toDate(b.createdAt) || 0) - (toDate(a.createdAt) || 0))
    .slice(0, 5);
  const statusCounts = { ordered: 0, pending: 0, delivered: 0, cancelled: 0 };
  CACHE.orders.forEach(o => { if (statusCounts[o.status] !== undefined) statusCounts[o.status]++; });

  container.innerHTML = `
    <div class="page-header">
      <div>
        <h1>لوحة التحكم</h1>
        <p class="page-subtitle">مرحبًا بك، إليك نظرة سريعة على أداء متجرك اليوم</p>
      </div>
      <div class="page-actions">
        <button class="btn btn-light" id="btn-refresh"><i class="bi bi-arrow-clockwise me-1"></i> تحديث</button>
        <a href="#/products" class="btn btn-primary"><i class="bi bi-plus-lg me-1"></i> إضافة منتج</a>
      </div>
    </div>

    <div class="stat-grid">
      <div class="stat-card stat-accent">
        <div class="stat-info">
          <p class="stat-label">عدد المنتجات</p>
          <p class="stat-value">${formatNumber(CACHE.products.length)}</p>
          <p class="stat-change"><i class="bi bi-box-seam"></i> إجمالي المنتجات</p>
        </div>
        <div class="stat-icon"><i class="bi bi-box-seam"></i></div>
      </div>
      <div class="stat-card stat-success">
        <div class="stat-info">
          <p class="stat-label">عدد الطلبات</p>
          <p class="stat-value">${formatNumber(CACHE.orders.length)}</p>
          <p class="stat-change up"><i class="bi bi-bag-check"></i> كل الطلبات</p>
        </div>
        <div class="stat-icon"><i class="bi bi-bag-check"></i></div>
      </div>
      <div class="stat-card stat-info">
        <div class="stat-info">
          <p class="stat-label">عدد العملاء</p>
          <p class="stat-value">${formatNumber(CACHE.customers.length)}</p>
          <p class="stat-change"><i class="bi bi-people"></i> عملاء مسجّلون</p>
        </div>
        <div class="stat-icon"><i class="bi bi-people"></i></div>
      </div>
      <div class="stat-card stat-warning">
        <div class="stat-info">
          <p class="stat-label">إجمالي المبيعات</p>
          <p class="stat-value">${formatCurrency(totalSales)}</p>
          <p class="stat-change up"><i class="bi bi-currency-dollar"></i> المبيعات الكلية</p>
        </div>
        <div class="stat-icon"><i class="bi bi-currency-dollar"></i></div>
      </div>
    </div>

    <div class="row g-3">
      <div class="col-lg-8">
        <div class="card">
          <div class="card-header d-flex justify-content-between align-items-center">
            <span><i class="bi bi-clock-history me-2"></i> آخر الطلبات</span>
            <a href="#/orders" class="btn btn-sm btn-outline-primary">عرض الكل</a>
          </div>
          <div class="card-body p-0">
            ${recentOrders.length === 0 ? '<div class="empty-state"><i class="bi bi-bag-x"></i><h5>لا توجد طلبات</h5></div>' : `
              <div class="table-responsive">
                <table class="table table-hover align-middle">
                  <thead>
                    <tr><th>رقم الطلب</th><th>العميل</th><th>التاريخ</th><th>الحالة</th><th>الإجمالي</th></tr>
                  </thead>
                  <tbody>
                    ${recentOrders.map(o => {
    const custName = o.shippingAddress?.name || '';
    return `
                        <tr style="cursor:pointer;" onclick="window.location.hash='#/orders'">
                          <td><strong>#${esc(o.id.substring(0, 8))}</strong></td>
                          <td>
                            <div class="d-flex align-items-center gap-2">
                              <div class="avatar-circle" style="width:32px;height:32px;font-size:0.75rem;">${esc((custName || 'ع').charAt(0))}</div>
                              <span>${esc(custName || 'عميل')}</span>
                            </div>
                          </td>
                          <td><span style="font-size:0.82rem;">${formatDate(o.createdAt)}</span></td>
                          <td>${getStatusBadge(o.status)}</td>
                          <td><strong>${formatCurrency(o.total)}</strong></td>
                        </tr>
                      `;
  }).join('')}
                  </tbody>
                </table>
              </div>
            `}
          </div>
        </div>
      </div>
      <div class="col-lg-4">
        <div class="card mb-3">
          <div class="card-header"><i class="bi bi-pie-chart me-2"></i> الطلبات حسب الحالة</div>
          <div class="card-body">
            ${Object.entries(statusCounts).map(([k, v]) => {
    const labels = { ordered: 'تم الطلب', pending: 'قيد المعالجة', delivered: 'تم التوصيل', cancelled: 'ملغي' };
    const colors = { ordered: 'secondary', pending: 'warning', delivered: 'success', cancelled: 'danger' };
    const pct = CACHE.orders.length ? Math.round((v / CACHE.orders.length) * 100) : 0;
    return `
                <div class="mb-2">
                  <div class="d-flex justify-content-between mb-1">
                    <span style="font-size:0.85rem;">${labels[k]}</span>
                    <span style="font-size:0.85rem;font-weight:600;">${v}</span>
                  </div>
                  <div class="progress" style="height:6px;">
                    <div class="progress-bar bg-${colors[k]}" style="width:${pct}%"></div>
                  </div>
                </div>
              `;
  }).join('')}
          </div>
        </div>
        <div class="card">
          <div class="card-header"><i class="bi bi-tags me-2"></i> أكثر الفئات</div>
          <div class="card-body">
            ${CACHE.categories.slice(0, 5).map((c, i) => {
    const count = CACHE.products.filter(p => p.categoryId === c.id).length;
    return `
                <div class="d-flex align-items-center gap-2 mb-2">
                  <div class="avatar-circle" style="width:32px;height:32px;background:var(--bg-surface-3);color:var(--text-secondary);font-size:0.75rem;">${i + 1}</div>
                  <div class="flex-grow-1"><div style="font-size:0.85rem;font-weight:600;">${esc(c.nameAr || c.nameEn || '—')}</div></div>
                  <span class="badge bg-secondary-soft">${count} منتج</span>
                </div>
              `;
  }).join('') || '<p class="text-muted text-center mb-0">لا توجد فئات</p>'}
          </div>
        </div>
      </div>
    </div>
  `;
  $('#btn-refresh').addEventListener('click', async () => {
    await loadAllData();
    renderDashboard(container);
    showToast('تم تحديث البيانات', 'success');
  });
}

/* =========================================================
   9) صفحة المنتجات + رفع الصور
   ========================================================= */

const PAGE_SIZE = 50; // عدد العناصر المعروضة في الصفحة الواحدة

let productsState = { search: '', category: '', sort: 'newest', flag: '', visibleCount: PAGE_SIZE };

function renderProducts(container) {
  // إعادة تعيين الـ state عند فتح الصفحة
  productsState = { search: '', category: '', sort: 'newest', flag: '', visibleCount: PAGE_SIZE };
  container.innerHTML = `
    <div class="page-header">
      <div>
        <h1>إدارة المنتجات</h1>
        <p class="page-subtitle">إضافة وتعديل وحذف منتجات المتجر</p>
      </div>
      <div class="page-actions">
        <button class="btn btn-outline-secondary" id="btn-export-products"><i class="bi bi-download me-1"></i> تصدير</button>
        <button class="btn btn-primary" id="btn-add-product"><i class="bi bi-plus-lg me-1"></i> إضافة منتج</button>
      </div>
    </div>
    <div class="bulk-actions d-none align-items-center gap-2 p-2 mb-2 bg-light rounded" id="bulk-bar">
      <span class="small" id="bulk-count">0 محدد</span>
      <button class="btn btn-sm btn-outline-danger" id="bulk-delete"><i class="bi bi-trash me-1"></i>حذف المحدد</button>
      <button class="btn btn-sm btn-outline-primary" id="bulk-bestseller"><i class="bi bi-star me-1"></i>الأكثر مبيعاً</button>
      <button class="btn btn-sm btn-outline-primary" id="bulk-new"><i class="bi bi-star me-1"></i>جديد</button>
      <button class="btn btn-sm btn-outline-primary" id="bulk-exclusive"><i class="bi bi-star me-1"></i>حصري</button>
    </div>
    <div class="filter-bar">
      <div class="search-box"><i class="bi bi-search"></i><input type="text" id="p-search" placeholder="ابحث بالاسم أو العلامة..." /></div>
      <select class="form-select" id="p-cat" style="max-width:200px;">
        <option value="">كل الفئات</option>
        ${CACHE.categories.map(c => `<option value="${c.id}">${esc(c.nameAr || c.nameEn || '—')}</option>`).join('')}
      </select>
      <select class="form-select" id="p-flag" style="max-width:160px;">
        <option value="">كل الأنواع</option>
        <option value="isBestSeller">الأكثر مبيعًا</option>
        <option value="isNew">جديد</option>
        <option value="isExclusive">حصري</option>
      </select>
      <select class="form-select" id="p-sort" style="max-width:180px;">
        <option value="newest">الأحدث أولًا</option>
        <option value="oldest">الأقدم أولًا</option>
        <option value="price-high">السعر: الأعلى</option>
        <option value="price-low">السعر: الأقل</option>
        <option value="name">الاسم: أبجديًا</option>
      </select>
    </div>
    <div class="card"><div class="card-body p-0"><div id="p-table"></div></div></div>
  `;
  $('#btn-add-product').addEventListener('click', () => openProductModal());
  let pSearchTimer; $('#p-search').addEventListener('input', e => {
    clearTimeout(pSearchTimer); pSearchTimer = setTimeout(() => {
      productsState.search = e.target.value; productsState.visibleCount = PAGE_SIZE; renderProductsTable();
    }, 300);
  });
  $('#p-cat').addEventListener('change', e => { productsState.category = e.target.value; productsState.visibleCount = PAGE_SIZE; renderProductsTable(); });
  $('#p-flag').addEventListener('change', e => { productsState.flag = e.target.value; productsState.visibleCount = PAGE_SIZE; renderProductsTable(); });
  $('#p-sort').addEventListener('change', e => { productsState.sort = e.target.value; productsState.visibleCount = PAGE_SIZE; renderProductsTable(); });
  $('#btn-export-products').addEventListener('click', () => {
    const cols = [
      { label: 'الاسم (عربي)', value: 'nameAr' },
      { label: 'الاسم (إنجليزي)', value: 'nameEn' },
      { label: 'السعر الأصلي', value: 'originalPrice' },
      { label: 'السعر بعد الخصم', value: 'price' },
      { label: 'نسبة الخصم', value: 'discountPercent' },
      { label: 'المخزون', value: 'stockQuantity' },
      { label: 'الأكثر مبيعاً', value: item => item.isBestSeller ? 'نعم' : 'لا' },
      { label: 'جديد', value: item => item.isNew ? 'نعم' : 'لا' },
      { label: 'حصري', value: item => item.isExclusive ? 'نعم' : 'لا' },
    ];
    exportToCSV(CACHE.products, cols, 'المنتجات');
  });
  // Bulk actions
  $('#bulk-delete').addEventListener('click', async () => {
    const selected = CACHE.products.filter(p => p._selected);
    if (!selected.length) { showToast('اختر منتجات أولاً', 'error'); return; }
    const ok = await confirmAction(`حذف ${selected.length} منتج؟`, 'حذف مجموعة', 'حذف الكل', 'danger');
    if (!ok) return;
    for (const p of selected) await remove('products', p.id);
    CACHE.products = CACHE.products.filter(p => !p._selected);
    renderProductsTable();
    showToast(`تم حذف ${selected.length} منتج`, 'success');
  });
  ['bulk-bestseller', 'bulk-new', 'bulk-exclusive'].forEach(id => {
    $(`#${id}`).addEventListener('click', async () => {
      const selected = CACHE.products.filter(p => p._selected);
      if (!selected.length) { showToast('اختر منتجات أولاً', 'error'); return; }
      const flag = id === 'bulk-bestseller' ? 'isBestSeller' : id === 'bulk-new' ? 'isNew' : 'isExclusive';
      const vals = selected.map(p => p[flag]);
      const allSame = vals.every(v => v === vals[0]);
      const newVal = !allSame ? true : !vals[0];
      for (const p of selected) {
        await update('products', p.id, { [flag]: newVal });
        p[flag] = newVal;
      }
      renderProductsTable();
      showToast(`تم تحديث ${selected.length} منتج`, 'success');
    });
  });
  renderProductsTable();
}

function renderProductsTable() {
  const wrap = $('#p-table');
  let items = CACHE.products.filter(p => {
    const ms = !productsState.search ||
      arabicSearch(p.nameAr, productsState.search) ||
      arabicSearch(p.nameEn, productsState.search) ||
      arabicSearch(p.descriptionAr, productsState.search);
    const mc = !productsState.category || p.categoryId === productsState.category;
    const mf = !productsState.flag || p[productsState.flag] === true;
    return ms && mc && mf;
  });
  switch (productsState.sort) {
    case 'newest': items.sort((a, b) => (toDate(b.createdAt) || 0) - (toDate(a.createdAt) || 0)); break;
    case 'oldest': items.sort((a, b) => (toDate(a.createdAt) || 0) - (toDate(b.createdAt) || 0)); break;
    case 'price-high': items.sort((a, b) => (b.price || 0) - (a.price || 0)); break;
    case 'price-low': items.sort((a, b) => (a.price || 0) - (b.price || 0)); break;
    case 'name': items.sort((a, b) => (a.nameAr || '').localeCompare(b.nameAr || '', 'ar')); break;
  }
  if (items.length === 0) {
    wrap.innerHTML = `
      <div class="empty-state">
        <i class="bi bi-box-seam"></i>
        <h5>لا توجد منتجات</h5>
        <p>${CACHE.products.length === 0 ? 'ابدأ بإضافة أول منتج' : 'لا توجد نتائج مطابقة'}</p>
      </div>
    `;
    return;
  }
  // Pagination: عرض أول visibleCount عنصر فقط
  const visible = items.slice(0, productsState.visibleCount);
  const hasMore = items.length > productsState.visibleCount;
  const selCount = CACHE.products.filter(p => p._selected).length;
  const bulkBar = $('#bulk-bar');
  if (bulkBar) {
    bulkBar.classList.toggle('d-none', selCount === 0);
    bulkBar.classList.toggle('d-flex', selCount > 0);
    $('#bulk-count').textContent = `${selCount} محدد`;
  }
  wrap.innerHTML = `
    <div class="table-responsive">
      <table class="table table-hover align-middle">
        <thead>
          <tr>
            <th width="40"><input type="checkbox" id="p-select-all" class="form-check-input" ${visible.every(p => p._selected) && visible.length > 0 ? 'checked' : ''} /></th>
            <th width="60">الصورة</th>
            <th>اسم المنتج</th>
            <th>الفئة</th>
            <th>السعر</th>
            <th>المخزون</th>
            <th>التقييم</th>
            <th>العلامات</th>
            <th>تاريخ الإضافة</th>
            <th width="140">إجراءات</th>
          </tr>
        </thead>
        <tbody>
          ${visible.map(p => {
    const cat = CACHE.categories.find(c => c.id === p.categoryId);
    const inStock = (p.stockQuantity || 0) > 0;
    const flags = [];
    if (p.isBestSeller) flags.push('<span class="badge bg-success-soft">الأكثر مبيعًا</span>');
    if (p.isNew) flags.push('<span class="badge bg-info-soft">جديد</span>');
    if (p.isExclusive) flags.push('<span class="badge bg-warning-soft">حصري</span>');
    return `
              <tr class="${p._selected ? 'table-active' : ''}">
                <td><input type="checkbox" class="form-check-input p-select-row" data-id="${esc(p.id)}" ${p._selected ? 'checked' : ''} /></td>
                <td>
                  <div style="position:relative;display:inline-block;">
                    ${p.images && p.images.length > 0
        ? `<img src="${esc(p.images[0])}" class="table-img-thumb" alt="${esc(p.nameAr || '')}" onerror="this.src='data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 40 40%22><rect width=%2240%22 height=%2240%22 fill=%22%23262b3a%22/><text x=%2220%22 y=%2225%22 text-anchor=%22middle%22 fill=%22%236b7180%22 font-size=%2210%22>لا صورة</text></svg>'" />`
        : `<div class="table-img-thumb d-flex align-items-center justify-content-center"><i class="bi bi-image text-muted"></i></div>`}
                    <span style="position:absolute;bottom:-4px;inset-inline-end:-4px;font-size:0.6rem;padding:0.1rem 0.35rem;border-radius:50px;font-weight:700;${inStock ? 'background:var(--color-success-soft);color:#16a34a;border:2px solid var(--bg-card);' : 'background:var(--color-danger-soft);color:#dc2626;border:2px solid var(--bg-card);'}">${p.stockQuantity || 0}</span>
                  </div>
                </td>
                <td>
                  <div style="font-weight:600;">${esc(p.nameAr || '—')}</div>
                  <small class="text-muted">${esc(p.nameEn || '')}</small>
                </td>
                <td>${esc(cat ? (cat.nameAr || cat.nameEn || '—') : '—')}</td>
                <td>
                  <div style="font-weight:600;">${formatCurrency(p.price)}</div>
                  ${p.originalPrice && p.originalPrice > p.price ? `<small class="text-muted text-decoration-line-through">${formatCurrency(p.originalPrice)}</small>` : ''}
                </td>
                <td><span class="badge ${inStock ? 'bg-success-soft' : 'bg-danger-soft'}">${p.stockQuantity || 0}</span></td>
                <td>
                  <span style="color:var(--color-warning);"><i class="bi bi-star-fill"></i></span>
                  ${formatNumber(p.rating || 0)}
                  <small class="text-muted">(${p.reviewCount || 0})</small>
                </td>
                <td>${flags.join(' ') || '—'}</td>
                <td><span style="font-size:0.82rem;">${formatDate(p.createdAt)}</span></td>
                <td>
                  <div class="d-flex gap-1">
                    <button class="btn btn-icon btn-outline-primary" data-act="edit" data-id="${esc(p.id)}" title="تعديل"><i class="bi bi-pencil"></i></button>
                    <button class="btn btn-icon btn-outline-danger"  data-act="del"  data-id="${esc(p.id)}" title="حذف"><i class="bi bi-trash"></i></button>
                  </div>
                </td>
              </tr>
            `;
  }).join('')}
        </tbody>
      </table>
    </div>
    ${renderPaginationBar(visible.length, items.length, hasMore, 'p-table')}
  `;
  $$('#p-table [data-act]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const p = CACHE.products.find(x => x.id === btn.dataset.id);
      if (!p) return;
      if (btn.dataset.act === 'edit') {
        openProductModal(p);
      } else if (btn.dataset.act === 'del') {
        const ok = await confirmAction(`سيتم حذف المنتج "${p.nameAr}" نهائيًا. هل أنت متأكد؟`, 'حذف المنتج', 'حذف', 'danger');
        if (ok) {
          try {
            await remove('products', p.id);
            CACHE.products = CACHE.products.filter(x => x.id !== p.id);
            renderProductsTable();
            showToast('تم حذف المنتج', 'success');
          } catch (e) {
            showToast('تعذّر الحذف: ' + e.message, 'error');
          }
        }
      }
    });
  });
  // Checkbox select handlers
  $$('.p-select-row').forEach(cb => {
    cb.addEventListener('change', () => {
      const p = CACHE.products.find(x => x.id === cb.dataset.id);
      if (p) p._selected = cb.checked;
      renderProductsTable();
    });
  });
  $('#p-select-all').addEventListener('change', function () {
    const items = CACHE.products.slice(0, productsState.visibleCount);
    items.forEach(p => p._selected = this.checked);
    renderProductsTable();
  });
  // ربط زر تحميل المزيد
  const loadMoreBtn = $('#btn-load-more-p-table');
  if (loadMoreBtn) {
    loadMoreBtn.addEventListener('click', () => {
      if (loadMoreBtn.classList.contains('is-loading')) return;
      loadMoreBtn.classList.add('is-loading');
      loadMoreBtn.querySelector('.spinner-border').classList.remove('d-none');
      productsState.visibleCount += PAGE_SIZE;
      renderProductsTable();
    });
  }
}

/**
 * إنشاء شريط Pagination مع زر "تحميل المزيد"
 * @param {number} visible - عدد العناصر المعروضة حاليًا
 * @param {number} total - إجمالي العناصر المطابقة
 * @param {boolean} hasMore - هل يوجد المزيد
 * @param {string} idPrefix - بادئة للمعرّف الفريد (مثل 'p-table')
 * @returns {string} HTML
 */
function renderPaginationBar(visible, total, hasMore, idPrefix) {
  const btnId = `btn-load-more-${idPrefix}`;
  if (total <= PAGE_SIZE) {
    return `
      <div class="pagination-bar">
        <div class="pagination-info">
          إجمالي <strong>${formatNumber(total)}</strong> عنصر
        </div>
      </div>
    `;
  }
  return `
    <div class="pagination-bar">
      <div class="pagination-info">
        عرض <strong>${formatNumber(visible)}</strong> من <strong>${formatNumber(total)}</strong> عنصر
      </div>
      ${hasMore ? `
        <button class="btn-load-more" id="${btnId}">
          <span class="spinner-border spinner-border-sm d-none" role="status"></span>
          <i class="bi bi-arrow-down-circle"></i>
          تحميل المزيد (${formatNumber(total - visible)} متبقّي)
        </button>
      ` : `
        <span class="pagination-empty-msg"><i class="bi bi-check-circle text-success"></i> تم عرض الكل</span>
      `}
    </div>
  `;
}

/* =========================================================
   نظام رفع الصور — معالجة + تحويل إلى WebP + رفع لـ Firebase Storage
   ========================================================= */

/**
 * رفع صورة (DataURL) إلى Firebase Storage وإرجاع رابط التحميل
 * - إذا كانت الصورة URL عادي (http) → يُرجع كما هو بدون رفع
 * - إذا كانت DataURL → يرفعها إلى Firebase Storage
 */
async function uploadImageToStorage(dataUrl, folder = 'uploads') {
  if (!dataUrl) return '';
  if (dataUrl.startsWith('http')) return dataUrl;

  const filename = `${Date.now()}_${Math.random().toString(36).substring(2, 11)}.webp`;
  const ref = storage.ref(`${folder}/${filename}`);

  try {
    const snapshot = await ref.putString(dataUrl, 'data_url');
    return await snapshot.ref.getDownloadURL();
  } catch (error) {
    console.error('خطأ في رفع الصورة إلى Firebase Storage:', error);
    throw error;
  }
}

/**
 * رفع مجموعة صور (Parallel) وإرجاع روابطها
 */
async function uploadAllImages(images, folder = 'uploads') {
  if (!images || images.length === 0) return [];
  return await Promise.all(images.map(img => uploadImageToStorage(img, folder)));
}

/**
 * معالجة صورة واحدة: تحجيم + تحويل إلى WebP
 * @returns {Promise<{dataUrl, originalSize, processedSize, width, height, mimeType}>}
 */
function processImage(file, opts = {}) {
  return new Promise((resolve, reject) => {
    const { maxWidth = 1200, quality = 0.85, format = 'webp' } = opts;
    if (!file || !file.type.startsWith('image/')) {
      reject(new Error('الملف ليس صورة'));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('تعذّر قراءة الملف'));
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = () => reject(new Error('تعذّر تحميل الصورة'));
      img.onload = () => {
        let { width, height } = img;
        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        // خلفية بيضاء للصور الشفافة (PNG) لتفادي الأسود في JPEG
        if (format === 'jpeg') {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, width, height);
        }
        ctx.drawImage(img, 0, 0, width, height);
        // محاولة WebP أولاً، الرجوع إلى JPEG إن لم يدعمه المتصفح
        let mimeType = `image/${format}`;
        let dataUrl;
        try {
          dataUrl = canvas.toDataURL(mimeType, quality);
          if (!dataUrl.startsWith(`data:${mimeType}`)) {
            mimeType = 'image/jpeg';
            dataUrl = canvas.toDataURL(mimeType, quality);
          }
        } catch (err) {
          mimeType = 'image/jpeg';
          dataUrl = canvas.toDataURL(mimeType, quality);
        }
        const originalSize = file.size;
        const base64 = dataUrl.split(',')[1];
        const processedSize = Math.round((base64.length * 3) / 4);
        resolve({ dataUrl, originalSize, processedSize, width, height, mimeType });
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

/**
 * تهيئة نظام رفع الصور داخل modal
 * @param {HTMLElement} modalEl
 * @param {Object} opts - { mode, dropzoneId, inputId, previewId, existing, maxWidth, quality }
 * @returns {{ getImages, setImages, clear }}
 */
function setupImageUploader(modalEl, opts) {
  const {
    mode = 'multi',
    dropzoneId, inputId, previewId,
    existing = [],
    maxWidth = 1200, quality = 0.85,
  } = opts;

  let images = [...existing];
  const dropzone = modalEl.querySelector(`#${dropzoneId}`);
  const input = modalEl.querySelector(`#${inputId}`);
  const preview = modalEl.querySelector(`#${previewId}`);
  if (!dropzone || !input || !preview) return null;

  function render() {
    preview.innerHTML = images.map((url, idx) => `
      <div class="image-preview-item" data-idx="${idx}">
        <img src="${esc(url)}" alt="صورة ${idx + 1}" />
        <button type="button" class="remove-btn" data-idx="${idx}" title="حذف">
          <i class="bi bi-x"></i>
        </button>
        <div class="image-info"><span>${idx + 1}</span></div>
      </div>
    `).join('');
    preview.querySelectorAll('.remove-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.idx);
        images.splice(idx, 1);
        render();
      });
    });
  }

  async function handleFiles(files) {
    const arr = Array.from(files).filter(f => f.type.startsWith('image/'));
    if (arr.length === 0) {
      showToast('لم يتم اختيار صور صحيحة', 'warning');
      return;
    }
    const filesToProcess = mode === 'single' ? arr.slice(0, 1) : arr;
    if (mode === 'single') images = [];

    // إظهار حالة المعالجة
    const placeholderIdx = [];
    filesToProcess.forEach(() => {
      const idx = images.length;
      images.push('__processing__');
      placeholderIdx.push(idx);
    });
    render();

    // معالجة الصور بالتوازي
    for (let i = 0; i < filesToProcess.length; i++) {
      const file = filesToProcess[i];
      const idx = placeholderIdx[i];
      try {
        const result = await processImage(file, { maxWidth, quality });
        images[idx] = result.dataUrl;
        render();
      } catch (e) {
        console.error('[ImageUploader] خطأ:', e);
        images.splice(idx, 1);
        render();
        showToast(`تعذّر معالجة صورة: ${e.message}`, 'error');
      }
    }
    if (filesToProcess.length > 0) {
      showToast(`تمت معالجة ${filesToProcess.length} صورة بنجاح`, 'success');
    }
  }

  // النقر لفتح منتقي الملفات
  dropzone.addEventListener('click', (e) => {
    if (e.target.closest('.remove-btn')) return;
    input.click();
  });

  input.addEventListener('change', (e) => {
    if (e.target.files.length > 0) handleFiles(e.target.files);
    input.value = '';
  });

  // السحب والإفلات
  ['dragenter', 'dragover'].forEach(evt => {
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.add('dragover');
    });
  });
  ['dragleave', 'dragend'].forEach(evt => {
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.target === dropzone) dropzone.classList.remove('dragover');
    });
  });
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropzone.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) handleFiles(e.dataTransfer.files);
  });

  // منع فتح الصورة خارج الـ dropzone
  ['dragover', 'drop'].forEach(evt => {
    modalEl.addEventListener(evt, (e) => {
      if (!e.target.closest(`#${dropzoneId}`)) e.preventDefault();
    });
  });

  render();
  return {
    getImages: () => [...images],
    setImages: (newImages) => { images = [...newImages]; render(); },
    clear: () => { images = []; render(); },
  };
}

/** Modal إضافة/تعديل منتج */
function openProductModal(product = null, opts = {}) {
  const isEdit = !!product;
  const bodyHTML = `
    <form id="p-form">
      <div class="row g-3">
        <div class="col-md-6">
          <div class="mb-3">
            <label class="form-label">الاسم (عربي) <span class="text-danger">*</span></label>
            <input type="text" class="form-control" name="nameAr" required placeholder="اسم المنتج بالعربية" />
          </div>
        </div>
        <div class="col-md-6">
          <div class="mb-3">
            <label class="form-label">الاسم (إنجليزي)</label>
            <input type="text" class="form-control" name="nameEn" placeholder="Product name in English" dir="ltr" />
          </div>
        </div>
        <div class="col-md-6">
          <div class="mb-3">
            <label class="form-label">الوصف (عربي)</label>
            <textarea class="form-control" name="descriptionAr" rows="2" placeholder="وصف المنتج بالعربية"></textarea>
          </div>
        </div>
        <div class="col-md-6">
          <div class="mb-3">
            <label class="form-label">الوصف (إنجليزي)</label>
            <textarea class="form-control" name="descriptionEn" rows="2" placeholder="Description in English" dir="ltr"></textarea>
          </div>
        </div>
        <div class="col-md-4">
          <div class="mb-3">
            <label class="form-label">الفئة</label>
            <select class="form-select" name="categoryId">
              <option value="">— اختر الفئة —</option>
              ${CACHE.categories.map(c => `<option value="${c.id}">${esc(c.nameAr || c.nameEn || '—')}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="col-md-4">
          <div class="mb-3">
            <label class="form-label">السعر الأصلي <span class="text-danger">*</span></label>
            <div class="input-group">
              <input type="number" class="form-control" name="price" min="0" step="0.01" required />
              <span class="input-group-text">KD</span>
            </div>
          </div>
        </div>
        <div class="col-md-4">
          <div class="mb-3">
            <label class="form-label">نسبة الخصم (%)</label>
            <input type="number" class="form-control" name="discountPercent" min="0" max="100" step="1" id="p-discount" />
            <small class="text-muted" id="p-final-price">السعر بعد الخصم: —</small>
          </div>
        </div>
        <div class="col-md-4">
          <div class="mb-3">
            <label class="form-label">الكمية في المخزون <span class="text-danger">*</span></label>
            <input type="number" class="form-control" name="stockQuantity" min="0" required />
          </div>
        </div>
        <div class="col-12">
          <div class="mb-3">
            <label class="form-label fw-bold">صور المنتج <span class="text-muted small">(يمكن رفع عدة صور)</span></label>
            <div class="image-uploader" id="p-img-dropzone">
              <i class="bi bi-cloud-arrow-up upload-icon"></i>
              <p>اسحب الصور هنا أو اضغط للاختيار من الجهاز</p>
              <small>JPG, PNG, WebP, GIF — يتم تحويلها تلقائيًا إلى WebP</small>
              <span class="format-hint"><i class="bi bi-magic"></i> معالجة تلقائية: تحجيم + ضغط</span>
              <input type="file" id="p-img-input" multiple accept="image/*" hidden />
            </div>
            <div class="image-preview-grid" id="p-img-preview"></div>
          </div>
        </div>
        <div class="col-12">
          <div class="mb-3">
            <label class="form-label fw-bold">المواصفات</label>
            <div class="specs-table-container">
              <table class="table table-bordered table-sm specs-table" id="specs-table">
                <thead>
                  <tr>
                    <th width="45%">المفتاح (اسم المواصفة)</th>
                    <th width="45%">القيمة</th>
                    <th width="10%">إجراء</th>
                  </tr>
                </thead>
                <tbody id="specs-tbody"></tbody>
              </table>
              <button type="button" class="btn btn-sm btn-outline-primary mt-2" id="btn-add-spec">
                <i class="bi bi-plus"></i> إضافة مواصفة
              </button>
            </div>
          </div>
        </div>
        <div class="col-12 flag-switches">
          <label class="form-label fw-bold">علامات المنتج</label>
          <div class="d-flex flex-wrap gap-4">
            <div class="form-check form-switch"><input class="form-check-input" type="checkbox" name="isBestSeller" id="fl-bs" /><label class="form-check-label" for="fl-bs">الأكثر مبيعًا</label></div>
            <div class="form-check form-switch"><input class="form-check-input" type="checkbox" name="isNew" id="fl-new" /><label class="form-check-label" for="fl-new">جديد</label></div>
            <div class="form-check form-switch"><input class="form-check-input" type="checkbox" name="isExclusive" id="fl-ex" /><label class="form-check-label" for="fl-ex">حصري</label></div>
          </div>
        </div>

        <!-- خيارات المنتج (Options) -->
        <div class="col-12">
          <div class="mb-3">
            <label class="form-label fw-bold"><i class="bi bi-list-stars me-1"></i> خيارات المنتج (مثل: اللون، المقاس، السعة)</label>
            <div class="options-table-container">
              <table class="table table-bordered table-sm options-table" id="options-table">
                <thead>
                  <tr>
                    <th width="35%">اسم الخيار</th>
                    <th width="55%">القيم المتاحة (افصل بينها بفاصلة)</th>
                    <th width="10%">إجراء</th>
                  </tr>
                </thead>
                <tbody id="options-tbody"></tbody>
              </table>
              <button type="button" class="btn btn-sm btn-outline-primary mt-2" id="btn-add-option">
                <i class="bi bi-plus"></i> إضافة خيار
              </button>
            </div>
          </div>
        </div>
      </div>
    </form>
  `;

  let imageUploaderRef = null;
  closeModal('product-modal');
  openModal({
    id: 'product-modal',
    title: isEdit ? 'تعديل منتج' : 'إضافة منتج جديد',
    bodyHTML, large: true,
    submitText: isEdit ? 'حفظ التعديلات' : 'إضافة المنتج',
    onHidden: opts.onHidden,
    onSubmit: async (modalEl) => {
      const form = modalEl.querySelector('#p-form');
      if (!form.checkValidity()) { form.reportValidity(); return false; }
      const data = getFormData(form);
      if (!data.price || data.price < 0) { showToast('أدخل سعرًا صحيحًا', 'error'); return false; }
      const images = imageUploaderRef ? imageUploaderRef.getImages() : [];
      const specs = {};
      modalEl.querySelectorAll('#specs-tbody tr').forEach(row => {
        const key = row.querySelector('.spec-key')?.value?.trim();
        const value = row.querySelector('.spec-value')?.value?.trim();
        if (key && value) specs[key] = value;
      });
      const searchKeywords = [...new Set([
        ...generateSearchKeywords(data.nameAr, data.nameEn),
        ...expandToAllSubstrings(data.nameAr),
        ...expandToAllSubstrings(data.nameEn),
      ])];
      const options = {};
      modalEl.querySelectorAll('#options-tbody tr').forEach(tr => {
        const k = tr.querySelector('.opt-key').value.trim();
        const v = tr.querySelector('.opt-val').value;
        if (k && v) {
          options[k] = v.split(',').map(s => s.trim()).filter(Boolean);
        }
      });
      const payload = {
        nameAr: data.nameAr,
        nameEn: data.nameEn || '',
        descriptionAr: data.descriptionAr || '',
        descriptionEn: data.descriptionEn || '',
        categoryId: data.categoryId || '',
        originalPrice: Number(data.price),
        price: data.discountPercent ? Number(data.price) * (1 - Number(data.discountPercent) / 100) : Number(data.price),
        discountPercent: data.discountPercent ? Number(data.discountPercent) : 0,
        stockQuantity: Number(data.stockQuantity) || 0,
        reviewCount: product?.reviewCount || 0,
        images, specs, searchKeywords,
        isBestSeller: !!data.isBestSeller,
        isNew: !!data.isNew,
        isExclusive: !!data.isExclusive,
        options,
      };
      try {
        showToast('جاري رفع الصور...', 'info', 2000);
        payload.images = await uploadAllImages(images, 'products');
        if (isEdit) {
          await update('products', product.id, payload);
          Object.assign(product, payload);
          showToast('تم تحديث المنتج', 'success');
        } else {
          const newId = await add('products', payload);
          CACHE.products.push({ id: newId, ...payload, createdAt: new Date() });
          if (opts.onCreated) opts.onCreated(newId);
          showToast('تمت إضافة المنتج', 'success');
        }
        if ($('#p-table')) renderProductsTable();
        return true;
      } catch (e) {
        showToast('خطأ: ' + e.message, 'error');
        return false;
      }
    },
    onShown: (modalEl) => {
      imageUploaderRef = setupImageUploader(modalEl, {
        mode: 'multi',
        dropzoneId: 'p-img-dropzone',
        inputId: 'p-img-input',
        previewId: 'p-img-preview',
        existing: isEdit ? (product.images || []) : [],
        maxWidth: 1200, quality: 0.85,
      });
      // معاينة السعر بعد الخصم
      function updateFinalPrice() {
        const priceEl = modalEl.querySelector('input[name="price"]');
        const discEl = modalEl.querySelector('input[name="discountPercent"]');
        const finalEl = modalEl.querySelector('#p-final-price');
        const p = Number(priceEl.value) || 0;
        const d = Number(discEl.value) || 0;
        if (d > 0) {
          const finalPrice = p * (1 - d / 100);
          finalEl.textContent = `السعر بعد الخصم: ${finalPrice.toFixed(2)} KD`;
        } else {
          finalEl.textContent = 'السعر بعد الخصم: —';
        }
      }
      modalEl.querySelector('input[name="price"]').addEventListener('input', updateFinalPrice);
      modalEl.querySelector('input[name="discountPercent"]').addEventListener('input', updateFinalPrice);
      updateFinalPrice();
      // جدول المواصفات
      const tbody = modalEl.querySelector('#specs-tbody');
      const addBtn = modalEl.querySelector('#btn-add-spec');
      function addSpecRow(key = '', value = '') {
        const row = document.createElement('tr');
        row.innerHTML = `
          <td><input type="text" class="form-control form-control-sm spec-key" placeholder="مثال: اللون" value="${esc(key)}" /></td>
          <td><input type="text" class="form-control form-control-sm spec-value" placeholder="مثال: أسود" value="${esc(value)}" /></td>
          <td><button type="button" class="btn btn-sm btn-outline-danger btn-remove-spec"><i class="bi bi-trash"></i></button></td>
        `;
        tbody.appendChild(row);
        row.querySelector('.btn-remove-spec').addEventListener('click', () => row.remove());
      }
      addBtn.addEventListener('click', () => addSpecRow());

      function addOptionRow(key = '', val = '') {
        const tbodyOpts = modalEl.querySelector('#options-tbody');
        if (!tbodyOpts) return;
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td><input type="text" class="form-control form-control-sm opt-key" value="${esc(key)}" placeholder="اسم الخيار (مثل: اللون)"></td>
          <td>
            <div class="tags-input-wrapper">
              <div class="tags-list d-flex flex-wrap gap-1 mb-1"></div>
              <div class="input-group input-group-sm">
                <input type="text" class="form-control opt-tag-input" placeholder="اكتب القيمة ثم اضغط Enter أو +">
                <button class="btn btn-outline-primary btn-add-tag" type="button" title="إضافة قيمة"><i class="bi bi-plus-lg"></i></button>
              </div>
              <input type="hidden" class="opt-val" value="${esc(val)}">
            </div>
          </td>
          <td class="text-center align-middle"><button type="button" class="btn btn-sm btn-outline-danger btn-remove-opt"><i class="bi bi-trash"></i></button></td>
        `;
        
        const tagsList = tr.querySelector('.tags-list');
        const tagInput = tr.querySelector('.opt-tag-input');
        const hiddenVal = tr.querySelector('.opt-val');
        const addTagBtn = tr.querySelector('.btn-add-tag');
        
        let tags = val.split(',').map(s => s.trim()).filter(Boolean);
        
        const renderTags = () => {
          tagsList.innerHTML = tags.map((t, i) => 
            `<span class="badge bg-primary d-inline-flex align-items-center" style="font-size: 0.85rem; padding: 0.35rem 0.5rem;">
               ${esc(t)} 
               <i class="bi bi-x ms-1 remove-tag" data-idx="${i}" style="cursor: pointer; font-size: 1.2em; line-height: 1;"></i>
             </span>`
          ).join('');
          hiddenVal.value = tags.join(',');
          
          tagsList.querySelectorAll('.remove-tag').forEach(btn => {
            btn.addEventListener('click', (e) => {
              const idx = e.target.getAttribute('data-idx');
              tags.splice(idx, 1);
              renderTags();
            });
          });
        };
        
        renderTags();
        
        const addTagLogic = () => {
          const newTag = tagInput.value.trim();
          if (newTag && !tags.includes(newTag)) {
            tags.push(newTag);
            tagInput.value = '';
            renderTags();
          }
        };

        tagInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            addTagLogic();
          }
        });

        addTagBtn.addEventListener('click', () => {
          addTagLogic();
          tagInput.focus();
        });
        
        tr.querySelector('.btn-remove-opt').addEventListener('click', () => tr.remove());
        tbodyOpts.appendChild(tr);
      }
      const addOptionBtn = modalEl.querySelector('#btn-add-option');
      if (addOptionBtn) {
        addOptionBtn.addEventListener('click', () => addOptionRow());
      }

      if (isEdit) {
        setFormData(modalEl.querySelector('#p-form'), {
          nameAr: product.nameAr,
          nameEn: product.nameEn || '',
          descriptionAr: product.descriptionAr || '',
          descriptionEn: product.descriptionEn || '',
          categoryId: product.categoryId || '',
          price: product.originalPrice || product.price,
          originalPrice: '',
          discountPercent: product.discountPercent || '',
          stockQuantity: product.stockQuantity || 0,
          isBestSeller: product.isBestSeller,
          isNew: product.isNew,
          isExclusive: product.isExclusive,
        });
        const tbodyOpts = modalEl.querySelector('#options-tbody');
        tbodyOpts.innerHTML = '';
        Object.entries(product.options || {}).forEach(([k, v]) => addOptionRow(k, v.join(', ')));
        
        // Migration logic for editing old products with colors/sizes but no options map
        if (!product.options) {
          if (product.colors && product.colors.length > 0) addOptionRow('اللون', product.colors.join(', '));
          if (product.sizes && product.sizes.length > 0) addOptionRow('المقاس', product.sizes.join(', '));
        }
        tbody.innerHTML = '';
        Object.entries(product.specs || {}).forEach(([k, v]) => addSpecRow(k, v));
      } else {
        tbody.innerHTML = '';
      }
    },
  });
}

/* =========================================================
   10) صفحة الفئات (Categories)
   ========================================================= */

function renderCategories(container) {
  container.innerHTML = `
    <div class="page-header">
      <div>
        <h1>إدارة الفئات</h1>
        <p class="page-subtitle">إضافة وتعديل وحذف فئات المنتجات</p>
      </div>
      <div class="page-actions">
        <button class="btn btn-primary" id="btn-add-cat"><i class="bi bi-plus-lg me-1"></i> إضافة فئة</button>
      </div>
    </div>
    <div class="row g-3" id="cat-grid"></div>
  `;
  $('#btn-add-cat').addEventListener('click', () => openCategoryModal());
  renderCategoriesGrid();
}

function renderCategoriesGrid() {
  const grid = $('#cat-grid');
  CACHE.categories.sort((a, b) => (a.order ?? 999) - (b.order ?? 999) || (toDate(b.createdAt) || 0) - (toDate(a.createdAt) || 0));
  if (CACHE.categories.length === 0) {
    grid.innerHTML = `
      <div class="col-12">
        <div class="empty-state">
          <i class="bi bi-tags"></i>
          <h5>لا توجد فئات</h5>
          <button class="btn btn-primary mt-3" id="empty-add-cat"><i class="bi bi-plus-lg me-1"></i> إضافة فئة</button>
        </div>
      </div>
    `;
    $('#empty-add-cat').addEventListener('click', () => openCategoryModal());
    return;
  }
  grid.innerHTML = CACHE.categories.map(c => `
    <div class="col-sm-6 col-md-4 col-lg-3">
      <div class="card h-100">
        <div class="cat-card-icon">
          ${c.iconName ? `<span class="material-icons-outlined" style="font-size:3.2rem">${esc(getMaterialIconLigature(c.iconName))}</span>` : c.icon ? `<i class="bi ${esc(c.icon)}"></i>` : c.imageUrl ? `<img src="${esc(c.imageUrl)}" alt="${esc(c.nameAr)}" style="width:100%;height:100%;object-fit:cover" />` : `<i class="bi bi-tag"></i>`}
        </div>
        <div class="card-body">
          <h5 class="card-title mb-1">${esc(c.nameAr || '—')}</h5>
          <p class="text-muted small mb-2">${esc(c.nameEn || '')}</p>
          <div class="mb-2">${[
      c.isFeatured && '<span class="badge bg-accent-soft">مميزة</span>',
      c.isBestSeller && '<span class="badge bg-success-soft">الأكثر مبيعًا</span>',
      c.isNew && '<span class="badge bg-info-soft">جديد</span>',
      c.isExclusive && '<span class="badge bg-warning-soft">حصري</span>',
    ].filter(Boolean).join(' ') || ''}</div>
          ${c.createdAt ? `<p class="text-muted small mb-3"><i class="bi bi-calendar3 me-1"></i> ${formatDate(c.createdAt)}</p>` : ''}
          <div class="d-flex gap-1">
            <button class="btn btn-sm btn-outline-primary flex-grow-1" data-act="edit" data-id="${esc(c.id)}"><i class="bi bi-pencil me-1"></i> تعديل</button>
            <button class="btn btn-sm btn-outline-${c.isActive !== false ? 'warning' : 'success'}" data-act="toggle" data-id="${esc(c.id)}"><i class="bi bi-${c.isActive !== false ? 'pause' : 'play'}"></i></button>
            <button class="btn btn-sm btn-outline-danger" data-act="del" data-id="${esc(c.id)}"><i class="bi bi-trash"></i></button>
          </div>
        </div>
      </div>
    </div>
  `).join('');
  $$('#cat-grid [data-act]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const c = CACHE.categories.find(x => x.id === btn.dataset.id);
      if (!c) return;
      if (btn.dataset.act === 'edit') {
        openCategoryModal(c);
      } else if (btn.dataset.act === 'toggle') {
        try {
          await update('categories', c.id, { isActive: c.isActive === false });
          c.isActive = c.isActive === false;
          renderCategoriesGrid();
          showToast('تم التحديث', 'success');
        } catch (e) { showToast('خطأ: ' + e.message, 'error'); }
      } else if (btn.dataset.act === 'del') {
        const ok = await confirmAction(`سيتم حذف الفئة "${c.nameAr}" نهائيًا. هل أنت متأكد؟`, 'حذف الفئة', 'حذف', 'danger');
        if (ok) {
          try {
            await remove('categories', c.id);
            CACHE.categories = CACHE.categories.filter(x => x.id !== c.id);
            renderCategoriesGrid();
            showToast('تم حذف الفئة', 'success');
          } catch (e) { showToast('خطأ: ' + e.message, 'error'); }
        }
      }
    });
  });
}

const CATEGORY_ICONS_MATERIAL = [
  'devices', 'checkroom', 'home_outlined', 'spa_outlined', 'watch',
  'sports_soccer', 'chair', 'toys', 'headphones', 'local_cafe',
  'menu_book', 'fastfood', 'pets', 'directions_car', 'local_florist',
  'diamond', 'brush', 'laptop_mac', 'phone_iphone', 'stroller',
  'fitness_center', 'shopping_bag', 'shopping_cart', 'storefront',
  'inventory_2', 'category', 'kitchen', 'blender', 'microwave',
  'tv', 'camera_alt', 'videogame_asset', 'speaker', 'earbuds',
  'tablet_mac', 'desktop_windows', 'memory', 'print', 'mouse',
  'keyboard', 'power', 'lightbulb', 'bed', 'weekend', 'yard',
  'restaurant', 'bakery_dining', 'icecream', 'local_pizza', 'egg',
  'child_care', 'crib', 'backpack', 'school', 'sports_esports',
  'sports_basketball', 'sports_tennis', 'pool', 'hiking', 'two_wheeler',
  'flight', 'beach_access', 'redeem', 'card_giftcard', 'sell',
  'local_offer', 'wallet', 'payments', 'medication', 'health_and_safety',
  'face', 'content_cut', 'palette', 'construction', 'hardware',
  'cleaning_services', 'eco', 'agriculture', 'cruelty_free',
  'store', 'local_mall', 'point_of_sale', 'receipt_long', 'receipt',
  'qr_code_scanner', 'barcode_reader', 'loyalty', 'percent', 'discount',
  'price_check', 'price_change', 'request_quote', 'currency_exchange',
  'account_balance_wallet', 'credit_card', 'contactless', 'local_shipping',
  'delivery_dining', 'inventory', 'warehouse', 'assignment', 'fact_check',
  'production_quantity_limits', 'add_shopping_cart', 'remove_shopping_cart',
  'shopping_basket', 'shopping_cart_checkout', 'trolley', 'package_2',
  'support_agent', 'location_on', 'map', 'business_center', 'apartment',
  'domain', 'groups', 'person', 'badge', 'campaign', 'new_releases',
];

function getMaterialIconLigature(iconName) {
  const name = String(iconName || '').replace(/_outlined$/, '');
  const aliases = {
    barcode_reader: 'qr_code_scanner',
    discount: 'local_offer',
    shopping_cart_checkout: 'shopping_cart',
    trolley: 'shopping_cart',
    package_2: 'inventory_2',
    warehouse: 'store',
  };
  return aliases[name] || name;
}

function openCategoryModal(cat = null) {
  const isEdit = !!cat;
  const hasImage = isEdit && !!cat.imageUrl;
  const hasIcon = isEdit && !!(cat.iconName || cat.icon);
  const mediaType = isEdit ? (hasIcon ? 'icon' : 'image') : 'icon';
  const selectedIcon = isEdit ? (cat.iconName || 'devices') : 'devices';
  const bodyHTML = `
    <form id="cat-form">
      <div class="row g-3">
        <div class="col-md-6">
          <div class="mb-3">
            <label class="form-label">الاسم (عربي) <span class="text-danger">*</span></label>
            <input type="text" class="form-control" name="nameAr" required />
          </div>
        </div>
        <div class="col-md-6">
          <div class="mb-3">
            <label class="form-label">الاسم (إنجليزي)</label>
            <input type="text" class="form-control" name="nameEn" dir="ltr" />
          </div>
        </div>
        <div class="col-12">
          <hr class="my-2">
          <label class="form-label fw-bold mb-2">الشعار</label>
          <div class="d-flex gap-4 mb-3">
            <div class="form-check">
              <input class="form-check-input" type="radio" name="mediaType" id="media-icon" value="icon" ${mediaType === 'icon' ? 'checked' : ''} />
              <label class="form-check-label" for="media-icon"><i class="bi bi-grid-3x3-gap me-1"></i> أيقونة</label>
            </div>
            <div class="form-check">
              <input class="form-check-input" type="radio" name="mediaType" id="media-image" value="image" ${mediaType === 'image' ? 'checked' : ''} />
              <label class="form-check-label" for="media-image"><i class="bi bi-image me-1"></i> صورة</label>
            </div>
          </div>
          <div id="cat-icon-section" style="${mediaType === 'image' ? 'display:none' : ''}">
            <div class="mb-3">
              <div class="material-icon-picker" id="cat-icon-picker">
                <input type="hidden" name="iconName" value="${selectedIcon}" />
                <div class="icon-picker-current" id="icon-picker-current">
                  <span class="material-icons-outlined">${getMaterialIconLigature(selectedIcon)}</span>
                  <span>${selectedIcon.replace(/_/g, ' ')}</span>
                  <i class="bi bi-chevron-down"></i>
                </div>
                <div class="icon-picker-grid d-none" id="icon-picker-grid">
                  ${CATEGORY_ICONS_MATERIAL.map(ic =>
    `<div class="icon-picker-item${ic === selectedIcon ? ' active' : ''}" data-icon="${ic}"><span class="material-icons-outlined">${getMaterialIconLigature(ic)}</span></div>`
  ).join('')}
                </div>
              </div>
            </div>
          </div>
          <div id="cat-image-section" style="${mediaType === 'icon' ? 'display:none' : ''}">
            <div class="image-uploader" id="cat-img-dropzone">
              <i class="bi bi-cloud-arrow-up upload-icon"></i>
              <p>اسحب صورة هنا أو اضغط للاختيار</p>
              <small>سيتم تحويلها إلى WebP تلقائيًا</small>
              <input type="file" id="cat-img-input" accept="image/*" hidden />
            </div>
            <div class="image-preview-grid single-image-preview" id="cat-img-preview"></div>
          </div>
        </div>
        <div class="col-12">
          <hr class="my-2">
          <div class="row g-3">
            <div class="col-md-3">
              <label class="form-label">الترتيب</label>
              <input type="number" class="form-control" name="order" min="0" value="0" />
            </div>
            <div class="col-md-3">
              <label class="form-label">الحالة</label>
              <div class="form-check form-switch mt-2">
                <input class="form-check-input" type="checkbox" name="isActive" checked />
                <label class="form-check-label">مفعّل</label>
              </div>
            </div>
            <div class="col-md-6">
              <label class="form-label fw-bold">علامات الفئة</label>
              <div class="d-flex flex-wrap gap-3 mt-2">
                <div class="form-check form-switch"><input class="form-check-input" type="checkbox" name="isFeatured" id="cat-fl-feat" /><label class="form-check-label" for="cat-fl-feat">مميزة</label></div>
                <div class="form-check form-switch"><input class="form-check-input" type="checkbox" name="isBestSeller" id="cat-fl-bs" /><label class="form-check-label" for="cat-fl-bs">الأكثر مبيعًا</label></div>
                <div class="form-check form-switch"><input class="form-check-input" type="checkbox" name="isNew" id="cat-fl-new" /><label class="form-check-label" for="cat-fl-new">جديد</label></div>
                <div class="form-check form-switch"><input class="form-check-input" type="checkbox" name="isExclusive" id="cat-fl-ex" /><label class="form-check-label" for="cat-fl-ex">حصري</label></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </form>
  `;
  let catImageUploader = null;
  closeModal('cat-modal');
  openModal({
    id: 'cat-modal',
    title: isEdit ? 'تعديل فئة' : 'إضافة فئة جديدة',
    bodyHTML,
    submitText: isEdit ? 'حفظ التعديلات' : 'إضافة الفئة',
    onSubmit: async (modalEl) => {
      const form = modalEl.querySelector('#cat-form');
      if (!form.checkValidity()) { form.reportValidity(); return false; }
      const data = getFormData(form);
      if (!data.nameAr || !data.nameAr.trim()) { showToast('أدخل اسم الفئة', 'error'); return false; }
      const mediaTypeVal = modalEl.querySelector('input[name="mediaType"]:checked')?.value || 'icon';
      const images = catImageUploader ? catImageUploader.getImages() : [];
      const rawImageUrl = images.length > 0 ? images[0] : '';
      const selectedIcon = modalEl.querySelector('#cat-icon-picker input[name="iconName"]')?.value || 'devices';
      const payload = {
        nameAr: data.nameAr.trim(),
        nameEn: data.nameEn || '',
        iconName: mediaTypeVal === 'icon' ? selectedIcon : '',
        imageUrl: mediaTypeVal === 'image' ? rawImageUrl : '',
        order: Number(data.order) || 0,
        isActive: data.isActive !== false,
        isFeatured: !!data.isFeatured,
        isBestSeller: !!data.isBestSeller,
        isNew: !!data.isNew,
        isExclusive: !!data.isExclusive,
      };
      try {
        if (mediaTypeVal === 'image' && rawImageUrl && !rawImageUrl.startsWith('http')) {
          showToast('جاري رفع الصورة...', 'info', 2000);
          payload.imageUrl = await uploadImageToStorage(rawImageUrl, 'categories');
        }
        if (isEdit) {
          await update('categories', cat.id, payload);
          Object.assign(cat, payload);
          showToast('تم تحديث الفئة', 'success');
        } else {
          const newId = await add('categories', payload);
          CACHE.categories.push({ id: newId, ...payload, createdAt: new Date() });
          showToast('تمت إضافة الفئة', 'success');
        }
        renderCategoriesGrid();
        return true;
      } catch (e) { showToast('خطأ: ' + e.message, 'error'); return false; }
    },
    onShown: (modalEl) => {
      catImageUploader = setupImageUploader(modalEl, {
        mode: 'single',
        dropzoneId: 'cat-img-dropzone',
        inputId: 'cat-img-input',
        previewId: 'cat-img-preview',
        existing: isEdit && cat.imageUrl ? [cat.imageUrl] : [],
        maxWidth: 800, quality: 0.85,
      });
      // Toggle between icon and image
      const iconSection = modalEl.querySelector('#cat-icon-section');
      const imageSection = modalEl.querySelector('#cat-image-section');
      function toggleMediaType(val) {
        if (val === 'icon') {
          iconSection.style.display = '';
          imageSection.style.display = 'none';
        } else {
          iconSection.style.display = 'none';
          imageSection.style.display = '';
        }
      }
      modalEl.querySelectorAll('input[name="mediaType"]').forEach(r => {
        r.addEventListener('change', () => toggleMediaType(r.value));
      });
      // Icon picker logic
      const current = modalEl.querySelector('#icon-picker-current');
      const grid = modalEl.querySelector('#icon-picker-grid');
      const hiddenInput = modalEl.querySelector('#cat-icon-picker input[name="iconName"]');
      current.addEventListener('click', () => grid.classList.toggle('d-none'));
      grid.querySelectorAll('.icon-picker-item').forEach(item => {
        item.addEventListener('click', () => {
          grid.querySelectorAll('.icon-picker-item').forEach(el => el.classList.remove('active'));
          item.classList.add('active');
          const icon = item.dataset.icon;
          hiddenInput.value = icon;
          current.innerHTML = `<span class="material-icons-outlined">${getMaterialIconLigature(icon)}</span><span>${icon.replace(/_/g, ' ')}</span><i class="bi bi-chevron-down"></i>`;
          grid.classList.add('d-none');
        });
      });
      const closeIconPicker = (e) => {
        if (!e.target.closest('#cat-icon-picker')) {
          grid.classList.add('d-none');
          document.removeEventListener('click', closeIconPicker);
        }
      };
      document.addEventListener('click', closeIconPicker);
      modalEl.addEventListener('hidden.bs.modal', () => {
        document.removeEventListener('click', closeIconPicker);
      }, { once: true });
      if (isEdit) {
        setFormData(modalEl.querySelector('#cat-form'), {
          nameAr: cat.nameAr || '',
          nameEn: cat.nameEn || '',
          order: cat.order || 0,
          isActive: cat.isActive !== false,
          isFeatured: cat.isFeatured,
          isBestSeller: cat.isBestSeller,
          isNew: cat.isNew,
          isExclusive: cat.isExclusive,
          mediaType,
        });
        toggleMediaType(mediaType);
      }
    },
  });
}

/* =========================================================
   11) صفحة الطلبات (Orders)
   ========================================================= */

let ordersState = { search: '', status: '', sort: 'newest', visibleCount: PAGE_SIZE };

function renderOrders(container) {
  ordersState = { search: '', status: '', sort: 'newest', visibleCount: PAGE_SIZE };
  container.innerHTML = `
    <div class="page-header">
      <div>
        <h1>إدارة الطلبات</h1>
        <p class="page-subtitle">متابعة طلبات العملاء وتحديث حالتها</p>
      </div>
      <div class="page-actions">
        <button class="btn btn-outline-secondary" id="btn-export-orders"><i class="bi bi-download me-1"></i> تصدير</button>
      </div>
    </div>
    <div class="filter-bar">
      <div class="search-box"><i class="bi bi-search"></i><input type="text" id="o-search" placeholder="ابحث برقم الطلب أو اسم العميل..." /></div>
      <select class="form-select" id="o-status" style="max-width:200px;">
        <option value="">كل الحالات</option>
        <option value="ordered">تم الطلب</option>
        <option value="pending">قيد المعالجة</option>
        <option value="delivered">تم التوصيل</option>
        <option value="cancelled">ملغي</option>
      </select>
      <select class="form-select" id="o-sort" style="max-width:180px;">
        <option value="newest">الأحدث أولًا</option>
        <option value="oldest">الأقدم أولًا</option>
        <option value="total-high">المبلغ: الأعلى</option>
        <option value="total-low">المبلغ: الأقل</option>
      </select>
    </div>
    <div class="card"><div class="card-body p-0"><div id="o-table"></div></div></div>
  `;
  $('#o-search').addEventListener('input', e => { ordersState.search = e.target.value; ordersState.visibleCount = PAGE_SIZE; renderOrdersTable(); });
  $('#o-status').addEventListener('change', e => { ordersState.status = e.target.value; ordersState.visibleCount = PAGE_SIZE; renderOrdersTable(); });
  $('#o-sort').addEventListener('change', e => { ordersState.sort = e.target.value; ordersState.visibleCount = PAGE_SIZE; renderOrdersTable(); });
  $('#btn-export-orders').addEventListener('click', () => {
    const statusMap = { ordered: 'تم الطلب', pending: 'قيد المعالجة', delivered: 'تم التوصيل', cancelled: 'ملغي' };
    const cols = [
      { label: 'رقم الطلب', value: o => o.orderNumber || o.id },
      { label: 'العميل', value: o => o.shippingAddress?.name || '' },
      { label: 'الهاتف', value: o => o.shippingAddress?.phone || '' },
      { label: 'العنوان', value: o => o.shippingAddress?.address || '' },
      { label: 'المجموع', value: 'total' },
      { label: 'الحالة', value: o => statusMap[o.status] || o.status },
      { label: 'تاريخ', value: o => formatDate(o.createdAt) },
    ];
    exportToCSV(CACHE.orders, cols, 'الطلبات');
  });
  renderOrdersTable();
}

function renderOrdersTable() {
  const wrap = $('#o-table');
  let items = CACHE.orders.filter(o => {
    const custName = o.shippingAddress?.name || '';
    const ms = !ordersState.search ||
      arabicSearch(o.id, ordersState.search) ||
      arabicSearch(custName, ordersState.search) ||
      arabicSearch(o.shippingAddress?.city, ordersState.search);
    const mst = !ordersState.status || o.status === ordersState.status;
    return ms && mst;
  });
  switch (ordersState.sort) {
    case 'newest': items.sort((a, b) => (toDate(b.createdAt) || 0) - (toDate(a.createdAt) || 0)); break;
    case 'oldest': items.sort((a, b) => (toDate(a.createdAt) || 0) - (toDate(b.createdAt) || 0)); break;
    case 'total-high': items.sort((a, b) => (b.total || 0) - (a.total || 0)); break;
    case 'total-low': items.sort((a, b) => (a.total || 0) - (b.total || 0)); break;
  }
  if (items.length === 0) {
    wrap.innerHTML = `<div class="empty-state"><i class="bi bi-bag-x"></i><h5>لا توجد طلبات</h5></div>`;
    return;
  }
  // Pagination
  const visible = items.slice(0, ordersState.visibleCount);
  const hasMore = items.length > ordersState.visibleCount;
  const statusOptions = [
    { v: 'ordered', l: 'تم الطلب' },
    { v: 'pending', l: 'قيد المعالجة' },
    { v: 'delivered', l: 'تم التوصيل' },
    { v: 'cancelled', l: 'ملغي' },
  ];
  wrap.innerHTML = `
    <div class="table-responsive">
      <table class="table table-hover align-middle">
        <thead>
          <tr>
            <th>رقم الطلب</th>
            <th>العميل</th>
            <th>عدد المنتجات</th>
            <th>الإجمالي</th>
            <th>التاريخ</th>
            <th>الدفع</th>
            <th>الحالة</th>
            <th width="120">إجراءات</th>
          </tr>
        </thead>
        <tbody>
          ${visible.map(o => {
    const custName = o.shippingAddress?.name || 'عميل';
    const custPhone = normalizePhone(o.shippingAddress?.phone) || '';
    return `
              <tr>
                <td><strong>#${esc(o.id.substring(0, 8))}</strong></td>
                <td>
                  <div class="d-flex align-items-center">
                    <div class="customer-avatar">${esc(getInitials(custName))}</div>
                    <div class="ms-2">
                      <div class="fw-bold">${esc(custName)}</div>
                      <small class="text-muted">${custPhone || '—'}</small>
                    </div>
                  </div>
                </td>
                <td><span class="badge bg-secondary-soft">${(o.items || []).length} منتج</span></td>
                <td><strong>${formatCurrency(o.total)}</strong></td>
                <td><div style="font-size:0.82rem;">${formatDate(o.createdAt)}</div></td>
                <td><small>${esc(getPaymentMethodBadge(o.paymentMethod))}</small></td>
                <td>
                  <select class="status-select" data-id="${esc(o.id)}">
                    ${statusOptions.map(s => `<option value="${s.v}" ${o.status === s.v ? 'selected' : ''}>${s.l}</option>`).join('')}
                  </select>
                </td>
                <td>
                  <div class="d-flex gap-1">
                    <button class="btn btn-icon btn-outline-primary" data-act="view" data-id="${esc(o.id)}" title="عرض"><i class="bi bi-eye"></i></button>
                    <button class="btn btn-icon btn-outline-danger"  data-act="del"  data-id="${esc(o.id)}" title="حذف"><i class="bi bi-trash"></i></button>
                  </div>
                </td>
              </tr>
            `;
  }).join('')}
        </tbody>
      </table>
    </div>
    ${renderPaginationBar(visible.length, items.length, hasMore, 'o-table')}
  `;
  $$('#o-table .status-select').forEach(sel => {
    sel.addEventListener('change', async e => {
      const o = CACHE.orders.find(x => x.id === e.target.dataset.id);
      if (o) {
        try {
          await update('orders', o.id, { status: e.target.value });
          o.status = e.target.value;
          showToast('تم تحديث حالة الطلب', 'success');
        } catch (err) {
          showToast('خطأ: ' + err.message, 'error');
          e.target.value = o.status;
        }
      }
    });
  });
  $$('#o-table [data-act]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const o = CACHE.orders.find(x => x.id === btn.dataset.id);
      if (!o) return;
      if (btn.dataset.act === 'view') {
        showOrderDetails(o);
      } else if (btn.dataset.act === 'del') {
        const ok = await confirmAction(
          `سيتم حذف الطلب #${o.id.substring(0, 8)} نهائيًا. هل أنت متأكد؟`,
          'حذف الطلب',
          'حذف',
          'danger'
        );
        if (ok) {
          try {
            await remove('orders', o.id);
            CACHE.orders = CACHE.orders.filter(x => x.id !== o.id);
            renderOrdersTable();
            showToast('تم حذف الطلب', 'success');
          } catch (e) {
            showToast('تعذّر الحذف: ' + e.message, 'error');
          }
        }
      }
    });
  });
  // ربط زر تحميل المزيد
  const loadMoreBtn = $('#btn-load-more-o-table');
  if (loadMoreBtn) {
    loadMoreBtn.addEventListener('click', () => {
      if (loadMoreBtn.classList.contains('is-loading')) return;
      loadMoreBtn.classList.add('is-loading');
      loadMoreBtn.querySelector('.spinner-border').classList.remove('d-none');
      ordersState.visibleCount += PAGE_SIZE;
      renderOrdersTable();
    });
  }
}

function showOrderDetails(order) {
  const items = order.items || [];
  const addr = order.shippingAddress || {};
  const user = CACHE.customers.find(u => u.uid === order.userId);
  const subtotal = Number(order.subtotal ?? items.reduce((sum, it) => sum + (Number(it.price) || 0) * (Number(it.quantity) || 1), 0));
  const shipping = Number(order.shipping || 0);
  const total = Number(order.total ?? (subtotal + shipping));
  const bodyHTML = `
    <div class="invoice-box">
      <div class="invoice-header">
        <div>
          <span class="invoice-kicker">فاتورة طلب</span>
          <h3>#${esc(order.id.substring(0, 8))}</h3>
          <p>${formatDate(order.createdAt, true)}</p>
        </div>
        <div class="invoice-status">
          ${getStatusBadge(order.status)}
          <span>${esc(getPaymentMethodBadge(order.paymentMethod))}</span>
        </div>
      </div>

      <div class="invoice-parties">
        <div class="invoice-panel">
          <h6><i class="bi bi-person me-1"></i> العميل</h6>
          <div class="invoice-line"><span>الاسم</span><strong>${esc(addr.name || user?.displayName || '—')}</strong></div>
          <div class="invoice-line"><span>الهاتف</span><strong dir="ltr">${esc(normalizePhone(addr.phone || user?.phone || user?.phoneNumber) || '—')}</strong></div>
          <div class="invoice-line"><span>البريد</span><strong dir="ltr">${esc(user?.email || '—')}</strong></div>
        </div>
        <div class="invoice-panel">
          <h6><i class="bi bi-truck me-1"></i> التوصيل</h6>
          <div class="invoice-line"><span>المدينة</span><strong>${esc(addr.city || '—')}</strong></div>
          <div class="invoice-line"><span>العنوان</span><strong>${esc(addr.address || '—')}</strong></div>
          <div class="invoice-line"><span>العلامة</span><strong>${esc(addr.label || '—')}</strong></div>
          ${order.deliveryType ? `<div class="invoice-line mt-2 pt-2 border-top"><span>نوع التوصيل</span><strong>${order.deliveryType === 'fast' ? '<span class="badge bg-warning text-dark">⚡ توصيل سريع</span>' : '<span class="badge bg-light text-dark border">توصيل عادي</span>'}</strong></div>` : ''}
          ${order.deliveryDate ? `<div class="invoice-line"><span>تاريخ التوصيل</span><strong>${formatDate(order.deliveryDate)}</strong></div>` : ''}
          ${order.deliveryTime ? `<div class="invoice-line"><span>وقت التوصيل</span><strong dir="ltr">${esc(order.deliveryTime)}</strong></div>` : ''}
          ${(addr.latitude && addr.longitude) ? `<div class="mt-3"><a href="https://www.google.com/maps/search/?api=1&query=${addr.latitude},${addr.longitude}" target="_blank" class="btn btn-sm btn-outline-primary w-100"><i class="bi bi-geo-alt me-1"></i> عرض الموقع على الخريطة</a></div>` : ''}
        </div>
      </div>

      <div class="invoice-items">
        <div class="invoice-section-title">
          <h6><i class="bi bi-box-seam me-1"></i> المنتجات</h6>
          <span>${formatNumber(items.length)} منتج</span>
        </div>
        <div class="table-responsive">
          <table class="table invoice-table mb-0">
            <thead>
              <tr><th>المنتج</th><th>السعر</th><th>الكمية</th><th>الإجمالي</th></tr>
            </thead>
            <tbody>
              ${items.length === 0 ? '<tr><td colspan="4" class="text-center text-muted py-4">لا توجد منتجات</td></tr>' : items.map(it => {
    const qty = Number(it.quantity) || 1;
    const price = Number(it.price) || 0;
    return `
                  <tr>
                    <td>
                      <div class="invoice-product">
                        ${it.image ? `<img src="${esc(it.image)}" class="table-img-thumb" />` : '<span class="invoice-product-placeholder"><i class="bi bi-box"></i></span>'}
                        <div>
                          <div class="fw-bold">${esc(it.nameAr || it.nameEn || '—')}</div>
                          ${(() => {
                            const opts = it.selectedOptions;
                            if (opts && typeof opts === 'object' && Object.keys(opts).length > 0) {
                              return `<div class="mt-1" style="font-size:0.8rem;">${Object.entries(opts).map(([k,v]) => `<span class="badge bg-light text-dark border me-1"><i class="bi bi-tag me-1"></i>${esc(k)}: ${esc(String(v))}</span>`).join('')}</div>`;
                            }
                            if (it.selectedColor || it.selectedSize) {
                              return `<div class="mt-1" style="font-size:0.8rem;">${it.selectedColor ? `<span class="badge bg-light text-dark border me-1"><i class="bi bi-palette me-1"></i>${esc(it.selectedColor)}</span>` : ''}${it.selectedSize ? `<span class="badge bg-light text-dark border"><i class="bi bi-rulers me-1"></i>${esc(it.selectedSize)}</span>` : ''}</div>`;
                            }
                            return '';
                          })()}
                        </div>
                      </div>
                    </td>
                    <td>${formatCurrency(price)}</td>
                    <td>${formatNumber(qty)}</td>
                    <td><strong>${formatCurrency(price * qty)}</strong></td>
                  </tr>
                `;
  }).join('')}
            </tbody>
          </table>
        </div>
      </div>

      <div class="invoice-totals">
        <div class="invoice-total-line"><span>المجموع الفرعي</span><strong>${formatCurrency(subtotal)}</strong></div>
        <div class="invoice-total-line"><span>الشحن</span><strong>${formatCurrency(shipping)}</strong></div>
        <div class="invoice-total-line grand"><span>الإجمالي</span><strong>${formatCurrency(total)}</strong></div>
      </div>
    </div>
  `;
  openModal({ id: 'order-details', title: 'تفاصيل الطلب', bodyHTML, cancelText: 'إغلاق', large: true });
}

/* =========================================================
   12) صفحة العملاء (Customers)
   ========================================================= */

let customersState = { search: '', status: '', visibleCount: PAGE_SIZE };

function renderCustomers(container) {
  if (!container) return;
  customersState = { search: '', status: '', visibleCount: PAGE_SIZE };
  // حساب إحصائيات لكل عميل
  CACHE.customers.forEach(c => {
    const orders = CACHE.orders.filter(o => o.userId === c.uid);
    c.ordersCount = orders.length;
    c.totalSpent = orders.filter(o => o.status !== 'cancelled').reduce((s, o) => s + Number(o.total || 0), 0);
  });
  container.innerHTML = `
    <div class="page-header">
      <div>
        <h1>إدارة العملاء</h1>
        <p class="page-subtitle">عرض وإدارة حسابات العملاء</p>
      </div>
      <div class="page-actions">
        <button class="btn btn-outline-secondary" id="btn-export-customers"><i class="bi bi-download me-1"></i> تصدير</button>
      </div>
    </div>
    <div class="filter-bar">
      <div class="search-box"><i class="bi bi-search"></i><input type="text" id="cu-search" placeholder="ابحث بالاسم أو البريد أو الهاتف..." /></div>
      <select class="form-select" id="cu-status" style="max-width:160px;">
        <option value="">كل الحالات</option>
        <option value="active">نشط</option>
        <option value="inactive">معطّل</option>
      </select>
    </div>
    <div class="card"><div class="card-body p-0"><div id="cu-table"></div></div></div>
  `;
  const search = $('#cu-search');
  const status = $('#cu-status');
  const exportBtn = $('#btn-export-customers');
  if (search) search.addEventListener('input', e => { customersState.search = e.target.value; customersState.visibleCount = PAGE_SIZE; renderCustomersTable(); });
  if (status) status.addEventListener('change', e => { customersState.status = e.target.value; customersState.visibleCount = PAGE_SIZE; renderCustomersTable(); });
  if (exportBtn) exportBtn.addEventListener('click', () => {
    const cols = [
      { label: 'الاسم', value: c => c.displayName || c.name || '' },
      { label: 'البريد', value: 'email' },
      { label: 'الهاتف', value: c => normalizePhone(c.phone || c.phoneNumber || '') },
      { label: 'عدد الطلبات', value: 'ordersCount' },
      { label: 'إجمالي الإنفاق', value: 'totalSpent' },
      { label: 'تاريخ التسجيل', value: c => formatDate(c.createdAt) },
    ];
    exportToCSV(CACHE.customers, cols, 'العملاء');
  });
  renderCustomersTable();
}

function renderCustomersTable() {
  const wrap = $('#cu-table');
  let items = CACHE.customers.filter(c => {
    const ms = !customersState.search ||
      arabicSearch(c.displayName, customersState.search) ||
      arabicSearch(c.email, customersState.search) ||
      arabicSearch(c.phone, customersState.search) ||
      arabicSearch(c.phoneNumber, customersState.search) ||
      arabicSearch(normalizePhone(c.phone || ''), customersState.search);
    const mst = !customersState.status ||
      (customersState.status === 'active' ? c.isActive !== false : c.isActive === false);
    return ms && mst;
  });
  if (items.length === 0) {
    wrap.innerHTML = `<div class="empty-state"><i class="bi bi-people"></i><h5>لا يوجد عملاء</h5></div>`;
    return;
  }
  // Pagination
  const visible = items.slice(0, customersState.visibleCount);
  const hasMore = items.length > customersState.visibleCount;
  wrap.innerHTML = `
    <div class="table-responsive">
      <table class="table table-hover align-middle">
        <thead>
          <tr>
            <th>العميل</th>
            <th>البريد الإلكتروني</th>
            <th>الهاتف</th>
            <th>عدد الطلبات</th>
            <th>إجمالي المشتريات</th>
            <th>تاريخ التسجيل</th>
            <th>الحالة</th>
            <th width="180">إجراءات</th>
          </tr>
        </thead>
        <tbody>
          ${visible.map(c => `
            <tr>
              <td>
                <div class="d-flex align-items-center gap-2">
                  <div class="avatar-circle">${esc((c.displayName || 'ع').charAt(0))}</div>
                  <div><div style="font-weight:600;">${esc(c.displayName || '—')}</div></div>
                </div>
              </td>
              <td>${esc(c.email || '—')}</td>
              <td>${esc(normalizePhone(c.phone || c.phoneNumber) || '—')}</td>
              <td><span class="badge bg-secondary-soft">${c.ordersCount || 0}</span></td>
              <td><strong>${formatCurrency(c.totalSpent || 0)}</strong></td>
              <td><span style="font-size:0.82rem;">${formatDate(c.createdAt)}</span></td>
              <td><span class="badge ${c.isActive !== false ? 'bg-success-soft' : 'bg-danger-soft'}">${c.isActive !== false ? 'نشط' : 'معطّل'}</span></td>
              <td>
                <div class="d-flex gap-1">
                  <button class="btn btn-icon btn-outline-primary" data-act="view" data-id="${esc(c.uid)}" title="عرض"><i class="bi bi-eye"></i></button>
                  <button class="btn btn-icon btn-outline-${c.isActive !== false ? 'warning' : 'success'}" data-act="toggle" data-id="${esc(c.uid)}" title="${c.isActive !== false ? 'تعطيل' : 'تفعيل'}"><i class="bi bi-${c.isActive !== false ? 'lock' : 'unlock'}"></i></button>
                  <button class="btn btn-icon btn-outline-danger" data-act="del" data-id="${esc(c.uid)}" title="حذف"><i class="bi bi-trash"></i></button>
                </div>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
    ${renderPaginationBar(visible.length, items.length, hasMore, 'cu-table')}
  `;
  $$('#cu-table [data-act]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const c = CACHE.customers.find(x => x.uid === btn.dataset.id);
      if (!c) return;
      if (btn.dataset.act === 'view') {
        showCustomerDetails(c);
      } else if (btn.dataset.act === 'toggle') {
        const newVal = c.isActive === false;
        try {
          await update('users', c.uid, { isActive: newVal });
          c.isActive = newVal;
          renderCustomersTable();
          showToast(`تم ${newVal ? 'تفعيل' : 'تعطيل'} الحساب`, 'success');
        } catch (e) { showToast('خطأ: ' + e.message, 'error'); }
      } else if (btn.dataset.act === 'del') {
        const ok = await confirmAction(
          `سيتم حذف العميل "${c.displayName || c.email}" نهائيًا. هل أنت متأكد؟`,
          'حذف العميل',
          'حذف',
          'danger'
        );
        if (ok) {
          try {
            await remove('users', c.uid);
            CACHE.customers = CACHE.customers.filter(x => x.uid !== c.uid);
            renderCustomersTable();
            showToast('تم حذف العميل', 'success');
          } catch (e) {
            showToast('تعذّر الحذف: ' + e.message, 'error');
          }
        }
      }
    });
  });
  // ربط زر تحميل المزيد
  const loadMoreBtn = $('#btn-load-more-cu-table');
  if (loadMoreBtn) {
    loadMoreBtn.addEventListener('click', () => {
      if (loadMoreBtn.classList.contains('is-loading')) return;
      loadMoreBtn.classList.add('is-loading');
      loadMoreBtn.querySelector('.spinner-border').classList.remove('d-none');
      customersState.visibleCount += PAGE_SIZE;
      renderCustomersTable();
    });
  }
}

function showCustomerDetails(c) {
  const customerOrders = CACHE.orders.filter(o => o.userId === c.uid).sort((a, b) => (toDate(b.createdAt) || 0) - (toDate(a.createdAt) || 0));
  const orderCount = customerOrders.length;
  const totalSpent = customerOrders.filter(o => o.status !== 'cancelled').reduce((s, o) => s + Number(o.total || 0), 0);
  const lastOrder = customerOrders[0];
  const statusLabels = { ordered: 'تم الطلب', pending: 'قيد المعالجة', delivered: 'تم التوصيل', cancelled: 'ملغي' };
  const bodyHTML = `
    <div class="text-center mb-3">
      <div class="avatar-circle mx-auto mb-2" style="width:80px;height:80px;font-size:2rem;">${esc((c.displayName || 'ع').charAt(0))}</div>
      <h5 class="mb-0">${esc(c.displayName || '—')}</h5>
      <p class="text-muted small mb-0">${esc(c.email || '—')}</p>
      <p class="text-muted small">${esc(normalizePhone(c.phone || c.phoneNumber) || '')}</p>
    </div>
    <div class="row g-2 mb-3">
      <div class="col-4">
        <div class="card text-center py-2">
          <div class="fs-5 fw-bold">${orderCount}</div>
          <small class="text-muted">طلبات</small>
        </div>
      </div>
      <div class="col-4">
        <div class="card text-center py-2">
          <div class="fs-5 fw-bold text-success">${formatCurrency(totalSpent)}</div>
          <small class="text-muted">إجمالي</small>
        </div>
      </div>
      <div class="col-4">
        <div class="card text-center py-2">
          <div class="fs-5 fw-bold">${formatDate(c.createdAt)}</div>
          <small class="text-muted">تاريخ التسجيل</small>
        </div>
      </div>
    </div>
    <h6 class="fw-bold mb-2"><i class="bi bi-clock-history me-1"></i> آخر الطلبات</h6>
    ${customerOrders.length === 0 ? '<p class="text-muted small">لا توجد طلبات</p>' : customerOrders.slice(0, 5).map(o => `
      <div class="d-flex justify-content-between align-items-center py-2 border-bottom">
        <div>
          <span class="fw-medium">#${esc(o.id.substring(0, 8))}</span>
          <span class="badge ${o.status === 'delivered' ? 'bg-success-soft' : o.status === 'cancelled' ? 'bg-danger-soft' : o.status === 'pending' ? 'bg-accent-soft' : 'bg-secondary-soft'} ms-2">${statusLabels[o.status] || o.status}</span>
        </div>
        <div class="text-end">
          <div class="fw-bold">${formatCurrency(o.total)}</div>
          <small class="text-muted">${formatDate(o.createdAt)}</small>
        </div>
      </div>
    `).join('')}
  `;
  openModal({ id: 'customer-details', title: 'تفاصيل العميل', bodyHTML, cancelText: 'إغلاق' });
}

/* =========================================================
   13) صفحة الكوبونات (Coupons) — collection: 'promoCodes'
   ========================================================= */

let couponsState = { search: '', status: '', visibleCount: PAGE_SIZE };

function renderCoupons(container) {
  if (!container) return;
  couponsState = { search: '', status: '', visibleCount: PAGE_SIZE };
  container.innerHTML = `
    <div class="page-header">
      <div>
        <h1>إدارة الكوبونات</h1>
        <p class="page-subtitle">إنشاء وإدارة أكواد الخصم</p>
      </div>
      <div class="page-actions">
        <button class="btn btn-primary" id="btn-add-coupon"><i class="bi bi-plus-lg me-1"></i> إضافة كوبون</button>
      </div>
    </div>
    <div class="filter-bar">
      <div class="search-box"><i class="bi bi-search"></i><input type="text" id="co-search" placeholder="ابحث بكود الكوبون..." /></div>
      <select class="form-select" id="co-status" style="max-width:160px;">
        <option value="">كل الحالات</option>
        <option value="active">مفعّل</option>
        <option value="inactive">معطّل</option>
      </select>
    </div>
    <div class="card"><div class="card-body p-0"><div id="co-table"></div></div></div>
  `;
  $('#btn-add-coupon').addEventListener('click', () => openCouponModal());
  $('#co-search').addEventListener('input', e => { couponsState.search = e.target.value; couponsState.visibleCount = PAGE_SIZE; renderCouponsTable(); });
  $('#co-status').addEventListener('change', e => { couponsState.status = e.target.value; couponsState.visibleCount = PAGE_SIZE; renderCouponsTable(); });
  renderCouponsTable();
}

function renderCouponsTable() {
  const wrap = $('#co-table');
  if (!wrap) return;
  let items = CACHE.coupons.filter(c => {
    const ms = !couponsState.search || arabicSearch(c.id, couponsState.search);
    const mst = !couponsState.status ||
      (couponsState.status === 'active' ? c.isActive !== false : c.isActive === false);
    return ms && mst;
  });
  if (items.length === 0) {
    wrap.innerHTML = `<div class="empty-state"><i class="bi bi-ticket-perforated"></i><h5>لا توجد كوبونات</h5></div>`;
    return;
  }
  // Pagination
  const visible = items.slice(0, couponsState.visibleCount);
  const hasMore = items.length > couponsState.visibleCount;
  wrap.innerHTML = `
    <div class="table-responsive">
      <table class="table table-hover align-middle">
        <thead>
          <tr>
            <th>كود الخصم</th>
            <th>نسبة الخصم</th>
            <th>الحالة</th>
            <th>تاريخ الإنشاء</th>
            <th width="140">إجراءات</th>
          </tr>
        </thead>
        <tbody>
          ${visible.map(c => `
            <tr>
              <td><code style="background:var(--bg-surface-3);padding:0.3rem 0.6rem;border-radius:6px;font-weight:700;color:var(--color-accent);">${esc(c.id)}</code></td>
              <td><strong>${c.discountPercent || 0}%</strong></td>
              <td><span class="badge ${c.isActive !== false ? 'bg-success-soft' : 'bg-secondary-soft'}">${c.isActive !== false ? 'مفعّل' : 'معطّل'}</span></td>
              <td><span style="font-size:0.82rem;">${formatDate(c.createdAt)}</span></td>
              <td>
                <div class="d-flex gap-1">
                  <button class="btn btn-icon btn-outline-primary" data-act="edit" data-id="${esc(c.id)}" title="تعديل"><i class="bi bi-pencil"></i></button>
                  <button class="btn btn-icon btn-outline-${c.isActive !== false ? 'warning' : 'success'}" data-act="toggle" data-id="${esc(c.id)}" title="${c.isActive !== false ? 'تعطيل' : 'تفعيل'}"><i class="bi bi-${c.isActive !== false ? 'pause' : 'play'}"></i></button>
                  <button class="btn btn-icon btn-outline-danger" data-act="del" data-id="${esc(c.id)}" title="حذف"><i class="bi bi-trash"></i></button>
                </div>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
    ${renderPaginationBar(visible.length, items.length, hasMore, 'co-table')}
  `;
  $$('#co-table [data-act]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const c = CACHE.coupons.find(x => x.id === btn.dataset.id);
      if (!c) return;
      if (btn.dataset.act === 'edit') {
        openCouponModal(c);
      } else if (btn.dataset.act === 'toggle') {
        try {
          await update('promoCodes', c.id, { isActive: c.isActive === false });
          c.isActive = c.isActive === false;
          renderCouponsTable();
          showToast('تم التحديث', 'success');
        } catch (e) { showToast('خطأ: ' + e.message, 'error'); }
      } else if (btn.dataset.act === 'del') {
        const ok = await confirmAction(`سيتم حذف الكوبون "${c.id}" نهائيًا. هل أنت متأكد؟`, 'حذف الكوبون', 'حذف', 'danger');
        if (ok) {
          try {
            await remove('promoCodes', c.id);
            CACHE.coupons = CACHE.coupons.filter(x => x.id !== c.id);
            renderCouponsTable();
            showToast('تم حذف الكوبون', 'success');
          } catch (e) { showToast('خطأ: ' + e.message, 'error'); }
        }
      }
    });
  });
  // ربط زر تحميل المزيد
  const loadMoreBtn = $('#btn-load-more-co-table');
  if (loadMoreBtn) {
    loadMoreBtn.addEventListener('click', () => {
      if (loadMoreBtn.classList.contains('is-loading')) return;
      loadMoreBtn.classList.add('is-loading');
      loadMoreBtn.querySelector('.spinner-border').classList.remove('d-none');
      couponsState.visibleCount += PAGE_SIZE;
      renderCouponsTable();
    });
  }
}

function openCouponModal(coupon = null) {
  const isEdit = !!coupon;
  const bodyHTML = `
    <form id="co-form">
      <div class="mb-3">
        <label class="form-label">كود الخصم <span class="text-danger">*</span></label>
        <input type="text" class="form-control" name="code" required placeholder="SUMMER2026" style="text-transform:uppercase;" ${isEdit ? 'readonly' : ''} />
        <small class="text-muted">يُستخدم كود الخصم كمعرّف فريد. ${isEdit ? 'لا يمكن تعديله بعد الإنشاء.' : ''}</small>
      </div>
      <div class="mb-3">
        <label class="form-label">نسبة الخصم (%) <span class="text-danger">*</span></label>
        <input type="number" class="form-control" name="discountPercent" min="0" max="100" step="1" required />
      </div>
      <div class="form-check form-switch">
        <input class="form-check-input" type="checkbox" name="isActive" checked />
        <label class="form-check-label">مفعّل</label>
      </div>
    </form>
  `;
  closeModal('co-modal');
  openModal({
    id: 'co-modal',
    title: isEdit ? 'تعديل كوبون' : 'إضافة كوبون جديد',
    bodyHTML,
    submitText: isEdit ? 'حفظ التعديلات' : 'إضافة الكوبون',
    onSubmit: async (modalEl) => {
      const form = modalEl.querySelector('#co-form');
      if (!form.checkValidity()) { form.reportValidity(); return false; }
      const data = getFormData(form);
      const code = (data.code || '').toUpperCase().trim();
      if (!code) { showToast('أدخل كود الخصم', 'error'); return false; }
      const payload = {
        discountPercent: Number(data.discountPercent) || 0,
        isActive: data.isActive !== false,
      };
      try {
        if (isEdit) {
          await update('promoCodes', code, payload);
          Object.assign(coupon, payload);
          showToast('تم تحديث الكوبون', 'success');
        } else {
          if (CACHE.coupons.some(x => x.id === code)) {
            showToast('كود الخصم موجود بالفعل', 'error');
            return false;
          }
          await addWithId('promoCodes', code, payload);
          CACHE.coupons.push({ id: code, ...payload, createdAt: new Date() });
          showToast('تمت إضافة الكوبون', 'success');
        }
        renderCouponsTable();
        return true;
      } catch (e) { showToast('خطأ: ' + e.message, 'error'); return false; }
    },
    onShown: (modalEl) => {
      if (isEdit) {
        setFormData(modalEl.querySelector('#co-form'), {
          code: coupon.id,
          discountPercent: coupon.discountPercent,
          isActive: coupon.isActive !== false,
        });
      }
    },
  });
}

/* =========================================================
   14) صفحة البانرات (Banners)
   ========================================================= */

let bannersState = { visibleCount: PAGE_SIZE };

function renderBanners(container) {
  if (!container) return;
  bannersState = { visibleCount: PAGE_SIZE, selectedZone: 'all' };
  const zones = [
    { key: 'all', label: 'الكل' },
    { key: 'header', label: 'البداية' },
    { key: 'middle', label: 'المنتصف' },
    { key: 'bottom', label: 'النهاية' },
  ];
  container.innerHTML = `
    <div class="page-header">
      <div>
        <h1>إدارة البانرات</h1>
        <p class="page-subtitle">إدارة بانرات العرض في الصفحة الرئيسية</p>
      </div>
      <div class="page-actions">
        <button class="btn btn-primary" id="btn-add-banner"><i class="bi bi-plus-lg me-1"></i> إضافة بانر</button>
      </div>
    </div>
    <div class="zone-tabs d-flex gap-1 mb-3 flex-wrap">
      ${zones.map(z => `
        <button class="btn btn-sm zone-tab ${bannersState.selectedZone === z.key ? 'btn-primary' : 'btn-outline-secondary'}" data-zone="${z.key}">${z.label}</button>
      `).join('')}
    </div>
    <div class="card"><div class="card-body p-0"><div id="b-list"></div></div></div>
  `;
  $$('.zone-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      bannersState.selectedZone = btn.dataset.zone;
      bannersState.visibleCount = PAGE_SIZE;
      renderBannersList();
      $$('.zone-tab').forEach(b => b.className = `btn btn-sm zone-tab ${bannersState.selectedZone === b.dataset.zone ? 'btn-primary' : 'btn-outline-secondary'}`);
    });
  });
  const btn = $('#btn-add-banner');
  if (btn) btn.addEventListener('click', () => openBannerModal());
  renderBannersList();
}

function renderBannersList() {
  const wrap = $('#b-list');
  if (!wrap) return;
  const zoneLabels = { header: 'البداية', middle: 'المنتصف', bottom: 'النهاية' };
  let filtered = CACHE.banners;
  if (bannersState.selectedZone && bannersState.selectedZone !== 'all') {
    filtered = filtered.filter(b => b.zone === bannersState.selectedZone);
  }
  if (filtered.length === 0) {
    wrap.innerHTML = `
      <div class="empty-state">
        <i class="bi bi-card-image"></i>
        <h5>لا توجد بانرات في هذه المنطقة</h5>
        <button class="btn btn-primary mt-3" id="empty-add-b"><i class="bi bi-plus-lg me-1"></i> إضافة بانر</button>
      </div>
    `;
    $('#empty-add-b').addEventListener('click', () => openBannerModal());
    return;
  }
  // Pagination
  const visible = filtered.slice(0, bannersState.visibleCount);
  const hasMore = filtered.length > bannersState.visibleCount;
  wrap.innerHTML = `
    <div class="table-responsive">
      <table class="table table-hover align-middle">
        <thead>
          <tr>
            <th width="200">الصورة</th>
            <th>العنوان</th>
            <th>المنطقة</th>
            <th>المنتجات</th>
            <th>الترتيب</th>
            <th>الحالة</th>
            <th width="140">إجراءات</th>
          </tr>
        </thead>
        <tbody>
          ${visible.map(b => {
    const pIds = b.productIds || [];
    return `
              <tr>
                <td>${b.imageUrl
        ? `<img src="${esc(b.imageUrl)}" style="width:160px;height:80px;object-fit:cover;border-radius:6px;" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';" /><div class="d-none align-items-center justify-content-center" style="width:160px;height:80px;background:var(--bg-input);border-radius:6px;"><i class="bi bi-image text-muted"></i></div>`
        : `<div class="d-flex align-items-center justify-content-center" style="width:160px;height:80px;background:var(--bg-input);border-radius:6px;"><i class="bi bi-image text-muted"></i></div>`}
                </td>
                <td>
                  <strong>${esc(b.titleAr || 'بدون عنوان')}</strong>
                  ${b.subtitleAr ? `<div><small class="text-muted">${esc(b.subtitleAr)}</small></div>` : ''}
                </td>
                <td><span class="badge bg-info-soft">${zoneLabels[b.zone] || b.zone || '—'}</span></td>
                <td><small class="text-muted">${pIds.length} منتج${pIds.length !== 1 ? 'ات' : ''}</small></td>
                <td><span class="badge bg-secondary-soft">${b.order || 0}</span></td>
                <td><span class="badge ${b.isActive !== false ? 'bg-success-soft' : 'bg-secondary-soft'}">${b.isActive !== false ? 'مفعّل' : 'معطّل'}</span></td>
                <td>
                  <div class="d-flex gap-1">
                    <button class="btn btn-icon btn-outline-primary" data-act="edit" data-id="${esc(b.id)}" title="تعديل"><i class="bi bi-pencil"></i></button>
                    <button class="btn btn-icon btn-outline-${b.isActive !== false ? 'warning' : 'success'}" data-act="toggle" data-id="${esc(b.id)}" title="${b.isActive !== false ? 'تعطيل' : 'تفعيل'}"><i class="bi bi-${b.isActive !== false ? 'pause' : 'play'}"></i></button>
                    <button class="btn btn-icon btn-outline-info" data-act="notify" data-id="${esc(b.id)}" title="إرسال إشعار"><i class="bi bi-bell"></i></button>
                    <button class="btn btn-icon btn-outline-danger" data-act="del" data-id="${esc(b.id)}" title="حذف"><i class="bi bi-trash"></i></button>
                  </div>
                </td>
              </tr>
            `;
  }).join('')}
        </tbody>
      </table>
    </div>
    ${renderPaginationBar(visible.length, filtered.length, hasMore, 'b-list')}
  `;
  $$('#b-list [data-act]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const b = CACHE.banners.find(x => x.id === btn.dataset.id);
      if (!b) return;
      if (btn.dataset.act === 'edit') {
        openBannerModal(b);
      } else if (btn.dataset.act === 'toggle') {
        try {
          await update('banners', b.id, { isActive: b.isActive === false });
          b.isActive = b.isActive === false;
          renderBannersList();
          showToast('تم التحديث', 'success');
        } catch (e) { showToast('خطأ: ' + e.message, 'error'); }
      } else if (btn.dataset.act === 'notify') {
        openSendNotifModal({ title: b.titleAr || 'عرض جديد', body: b.subtitleAr || 'تصفح أحدث المنتجات والعروض الحصرية' }, 'campaign', b.id);
      } else if (btn.dataset.act === 'del') {
        const ok = await confirmAction(`سيتم حذف البانر "${b.titleAr || 'بدون عنوان'}" نهائيًا. هل أنت متأكد؟`, 'حذف البانر', 'حذف', 'danger');
        if (ok) {
          try {
            await remove('banners', b.id);
            CACHE.banners = CACHE.banners.filter(x => x.id !== b.id);
            renderBannersList();
            showToast('تم حذف البانر', 'success');
          } catch (e) { showToast('خطأ: ' + e.message, 'error'); }
        }
      }
    });
  });
  // ربط زر تحميل المزيد
  const loadMoreBtn = $('#btn-load-more-b-list');
  if (loadMoreBtn) {
    loadMoreBtn.addEventListener('click', () => {
      if (loadMoreBtn.classList.contains('is-loading')) return;
      loadMoreBtn.classList.add('is-loading');
      loadMoreBtn.querySelector('.spinner-border').classList.remove('d-none');
      bannersState.visibleCount += PAGE_SIZE;
      renderBannersList();
    });
  }
}

function openBannerModal(banner = null, presetProductIds = null) {
  const isEdit = !!banner;
  let selectedProductIds = presetProductIds || (isEdit ? [...(banner.productIds || [])] : []);
  const prodCache = CACHE.products || [];
  const badgesContainerId = 'b-prod-badges';
  const modalId = 'b-modal';

  function refreshBadges() {
    const container = document.querySelector(`#${modalId} #${badgesContainerId}`);
    if (!container) return;
    container.innerHTML = selectedProductIds.length
      ? selectedProductIds.map(id => {
        const p = prodCache.find(x => x.id === id);
        const name = p ? (p.nameAr || p.nameEn) : id;
        return `<span class="badge bg-primary me-1 mb-1" style="font-size:0.85rem;padding:6px 12px;">
            ${esc(name)}
            <i class="bi bi-x ms-1" style="cursor:pointer" data-id="${esc(id)}"></i>
          </span>`;
      }).join('')
      : '<span class="text-muted small">لم يتم اختيار أي منتج</span>';
    container.querySelectorAll('.bi-x').forEach(icon => {
      icon.addEventListener('click', () => {
        selectedProductIds = selectedProductIds.filter(x => x !== icon.dataset.id);
        refreshBadges();
      });
    });
  }

  function openAddNewProduct() {
    const savedIds = [...selectedProductIds];
    closeModal('b-modal');
    openProductModal(null, {
      onCreated: (newId) => { savedIds.push(newId); },
      onHidden: () => { openBannerModal(banner, savedIds); },
    });
  }

  function openAddExistingProducts() {
    const savedIds = [...selectedProductIds];
    let searchTerm = '';
    let checkedIds = new Set(savedIds);

    function renderSubList(container) {
      const q = searchTerm.trim().toLowerCase();
      const filtered = q ? prodCache.filter(p =>
        (p.nameAr && p.nameAr.toLowerCase().includes(q)) ||
        (p.nameEn && p.nameEn.toLowerCase().includes(q))
      ) : prodCache;
      container.innerHTML = filtered.length
        ? filtered.map(p => {
          const isChecked = checkedIds.has(p.id);
          return `<div class="banner-prod-item ${isChecked ? 'added' : ''}" data-id="${esc(p.id)}">
              <span>${esc(p.nameAr || p.nameEn)}</span>
              <input type="checkbox" class="form-check-input" ${isChecked ? 'checked' : ''} />
            </div>`;
        }).join('')
        : '<div class="text-muted p-2 small">لا توجد منتجات</div>';
      container.querySelectorAll('.banner-prod-item').forEach(el => {
        el.addEventListener('click', (e) => {
          if (e.target.tagName === 'INPUT') return;
          const cb = el.querySelector('input[type="checkbox"]');
          cb.checked = !cb.checked;
          cb.dispatchEvent(new Event('change'));
        });
        const cb = el.querySelector('input[type="checkbox"]');
        cb.addEventListener('change', () => {
          const id = el.dataset.id;
          if (cb.checked) checkedIds.add(id);
          else checkedIds.delete(id);
          el.classList.toggle('added', cb.checked);
        });
      });
    }

    const listHTML = `
      <div class="mb-3">
        <input type="text" class="form-control" id="bep-search" placeholder="ابحث عن منتج..." autocomplete="off" />
        <div id="bep-list" class="banner-prod-list" style="max-height:350px;overflow-y:auto;border:1px solid var(--border-color);border-radius:6px;margin-top:6px;"></div>
      </div>`;
    closeModal('b-modal');
    closeModal('bep-modal');
    openModal({
      id: 'bep-modal',
      title: 'إضافة منتجات موجودة للبانر',
      bodyHTML: listHTML,
      submitText: 'إضافة المختارة',
      onSubmit: () => {
        const prevCount = savedIds.length;
        savedIds.length = 0;
        savedIds.push(...checkedIds);
        showToast(`تم تحديث قائمة المنتجات`, 'success');
        return true;
      },
      onHidden: () => { openBannerModal(banner, savedIds); },
      onShown: (mEl) => {
        const list = mEl.querySelector('#bep-list');
        const searchInput = mEl.querySelector('#bep-search');
        renderSubList(list);
        searchInput.addEventListener('input', () => {
          searchTerm = searchInput.value;
          renderSubList(list);
        });
      },
    });
  }

  const bodyHTML = `
    <form id="b-form">
      <div class="mb-3">
        <label class="form-label">صورة البانر <span class="text-danger">*</span></label>
        <div class="image-uploader" id="b-img-dropzone">
          <i class="bi bi-cloud-arrow-up upload-icon"></i>
          <p>اسحب صورة هنا أو اضغط للاختيار</p>
          <small>يُفضّل بأبعاد 1200×600 بكسل — سيتم تحويلها إلى WebP</small>
          <input type="file" id="b-img-input" accept="image/*" hidden />
        </div>
        <div class="image-preview-grid single-image-preview" id="b-img-preview"></div>
      </div>
      <div class="row g-3">
        <div class="col-md-6"><div class="mb-3"><label class="form-label">العنوان (عربي)</label><input type="text" class="form-control" name="titleAr" /></div></div>
        <div class="col-md-6"><div class="mb-3"><label class="form-label">العنوان (إنجليزي)</label><input type="text" class="form-control" name="titleEn" dir="ltr" /></div></div>
        <div class="col-md-6"><div class="mb-3"><label class="form-label">العنوان الفرعي (عربي)</label><input type="text" class="form-control" name="subtitleAr" /></div></div>
        <div class="col-md-6"><div class="mb-3"><label class="form-label">العنوان الفرعي (إنجليزي)</label><input type="text" class="form-control" name="subtitleEn" dir="ltr" /></div></div>
        <div class="col-12">
          <div class="mb-3">
            <label class="form-label">المنتجات المرتبطة <span class="text-danger">*</span></label>
            <div class="d-flex gap-2 mb-2 flex-wrap">
              <button type="button" class="btn btn-primary" id="b-add-new-prod"><i class="bi bi-plus-lg me-1"></i>إضافة منتج جديد</button>
              <button type="button" class="btn btn-outline-primary" id="b-add-existing-prod"><i class="bi bi-list-ul me-1"></i>إضافة من المنتجات الموجودة</button>
            </div>
            <div class="mt-2"><label class="form-label small text-muted">المنتجات المختارة:</label></div>
            <div id="b-prod-badges" class="d-flex flex-wrap gap-1"></div>
          </div>
        </div>
        <div class="col-md-4">
          <div class="mb-3">
            <label class="form-label">المنطقة</label>
              <select class="form-select" name="zone">
                <option value="header">البداية</option>
                <option value="middle">المنتصف</option>
                <option value="bottom">النهاية</option>
              </select>
            <small class="text-muted">اختر مكان ظهور البانر في التطبيق</small>
          </div>
        </div>
        <div class="col-md-4"><div class="mb-3"><label class="form-label">الترتيب</label><input type="number" class="form-control" name="order" min="0" value="0" /></div></div>
        <div class="col-md-4">
          <div class="mb-3">
            <label class="form-label">الحالة</label>
            <div class="form-check form-switch mt-2">
              <input class="form-check-input" type="checkbox" name="isActive" checked />
              <label class="form-check-label">مفعّل</label>
            </div>
          </div>
        </div>
      </div>
    </form>
  `;
  let bannerImageUploader = null;
  closeModal(modalId);
  openModal({
    id: modalId,
    title: isEdit ? 'تعديل بانر' : 'إضافة بانر جديد',
    bodyHTML, large: true,
    submitText: isEdit ? 'حفظ التعديلات' : 'إضافة البانر',
    onSubmit: async (modalEl) => {
      const form = modalEl.querySelector('#b-form');
      if (!form.checkValidity()) { form.reportValidity(); return false; }
      if (selectedProductIds.length === 0) { showToast('اختر منتجاً واحداً على الأقل للبانر', 'error'); return false; }
      const data = getFormData(form);
      const images = bannerImageUploader ? bannerImageUploader.getImages() : [];
      if (images.length === 0) { showToast('أضف صورة للبانر', 'error'); return false; }
      const rawImageUrl = images[0];
      const payload = {
        imageUrl: rawImageUrl,
        titleAr: data.titleAr || '',
        titleEn: data.titleEn || '',
        subtitleAr: data.subtitleAr || '',
        subtitleEn: data.subtitleEn || '',
        productIds: selectedProductIds,
        zone: data.zone || 'header',
        order: Number(data.order) || 0,
        isActive: data.isActive !== false,
      };
      try {
        if (rawImageUrl && !rawImageUrl.startsWith('http')) {
          showToast('جاري رفع صورة البانر...', 'info', 2000);
          payload.imageUrl = await uploadImageToStorage(rawImageUrl, 'banners');
        }
        if (isEdit) {
          await update('banners', banner.id, payload);
          Object.assign(banner, payload);
          showToast('تم تحديث البانر', 'success');
        } else {
          const newId = await add('banners', payload);
          CACHE.banners.push({ id: newId, ...payload, createdAt: new Date() });
          showToast('تمت إضافة البانر', 'success');
        }
        renderBannersList();
        return true;
      } catch (e) { showToast('خطأ: ' + e.message, 'error'); return false; }
    },
    onShown: (modalEl) => {
      bannerImageUploader = setupImageUploader(modalEl, {
        mode: 'single',
        dropzoneId: 'b-img-dropzone',
        inputId: 'b-img-input',
        previewId: 'b-img-preview',
        existing: isEdit && banner.imageUrl ? [banner.imageUrl] : [],
        maxWidth: 1600, quality: 0.85,
      });
      if (isEdit) {
        setFormData(modalEl.querySelector('#b-form'), {
          titleAr: banner.titleAr || '',
          titleEn: banner.titleEn || '',
          subtitleAr: banner.subtitleAr || '',
          subtitleEn: banner.subtitleEn || '',
          zone: banner.zone || 'header',
          order: banner.order || 0,
          isActive: banner.isActive !== false,
        });
      }
      refreshBadges();
      modalEl.querySelector('#b-add-new-prod')?.addEventListener('click', openAddNewProduct);
      modalEl.querySelector('#b-add-existing-prod')?.addEventListener('click', openAddExistingProducts);
    },
  });
}

/* =========================================================
   15) صفحة التقييمات (Reviews)
   ========================================================= */

let reviewsState = { search: '', rating: '' };

function renderReviews(container) {
  reviewsState = { search: '', rating: '' };
  container.innerHTML = `
    <div class="page-header">
      <div>
        <h1>التقييمات</h1>
        <p class="page-subtitle">مراجعة وحذف تقييمات العملاء على المنتجات</p>
      </div>
    </div>
    <div class="filter-bar">
      <div class="search-box"><i class="bi bi-search"></i><input type="text" id="rev-search" placeholder="ابحث باسم المستخدم أو التعليق أو المنتج..." /></div>
      <select class="form-select" id="rev-rating" style="max-width:160px;">
        <option value="all">كل التصنيفات</option>
        <option value="5">★★★★★ (5)</option>
        <option value="4">★★★★☆ (4)</option>
        <option value="3">★★★☆☆ (3)</option>
        <option value="2">★★☆☆☆ (2)</option>
        <option value="1">★☆☆☆☆ (1)</option>
      </select>
    </div>
    <div class="card"><div class="card-body p-0"><div id="rev-list"></div></div></div>
  `;
  $('#rev-search').addEventListener('input', e => { reviewsState.search = e.target.value; renderReviewsList(); });
  $('#rev-rating').addEventListener('change', e => { reviewsState.rating = e.target.value; renderReviewsList(); });
  renderReviewsList();
}

function renderReviewsList() {
  const wrap = $('#rev-list');
  let items = CACHE.reviews.filter(r => {
    const product = CACHE.products.find(p => p.id === r.productId);
    const productName = product?.nameAr || product?.nameEn || '';
    const ms = !reviewsState.search ||
      arabicSearch(r.userName, reviewsState.search) ||
      arabicSearch(r.comment, reviewsState.search) ||
      arabicSearch(productName, reviewsState.search);
    const mr = reviewsState.rating === 'all' || !reviewsState.rating || String(r.rating) === reviewsState.rating;
    return ms && mr;
  });
  if (items.length === 0) {
    wrap.innerHTML = `<div class="empty-state"><i class="bi bi-star"></i><h5>لا توجد تقييمات</h5></div>`;
    return;
  }
  wrap.innerHTML = items.map(r => {
    const product = CACHE.products.find(p => p.id === r.productId);
    const stars = '★'.repeat(r.rating || 0) + '☆'.repeat(5 - (r.rating || 0));
    return `
      <div class="review-item d-flex gap-3">
        <div class="avatar-circle">${esc((r.userName || 'م').charAt(0))}</div>
        <div class="flex-grow-1">
          <div class="d-flex justify-content-between">
            <div>
              <strong>${esc(r.userName || 'مستخدم')}</strong>
              <span class="review-stars ms-2">${stars}</span>
            </div>
            <small class="text-muted">${formatDate(r.createdAt)}</small>
          </div>
          <p class="mb-1 text-muted">على المنتج: <strong>${esc(product?.nameAr || r.productId || '—')}</strong></p>
          <p class="mb-2">${esc(r.comment || '—')}</p>
          <button class="btn btn-sm btn-outline-danger" data-rev-id="${esc(r.id)}"><i class="bi bi-trash me-1"></i> حذف</button>
        </div>
      </div>
    `;
  }).join('');
  $$('#rev-list [data-rev-id]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const r = CACHE.reviews.find(x => x.id === btn.dataset.revId);
      if (!r) return;
      const ok = await confirmAction('سيتم حذف هذا التقييم نهائيًا. هل أنت متأكد؟', 'حذف التقييم', 'حذف', 'danger');
      if (ok) {
        try {
          await removeReview(r);
          CACHE.reviews = CACHE.reviews.filter(x => x.id !== r.id);
          renderReviewsList();
          showToast('تم حذف التقييم', 'success');
        } catch (e) { showToast('خطأ: ' + e.message, 'error'); }
      }
    });
  });
}

/* =========================================================
   16) صفحة الإشعارات (Notifications)
   ========================================================= */

function renderNotifications(container) {
  if (!container) return;
  container.innerHTML = `
    <div class="page-header">
      <div>
        <h1>إدارة الإشعارات</h1>
        <p class="page-subtitle">إرسال إشعارات للمستخدمين</p>
      </div>
      <div class="page-actions">
        <button class="btn btn-primary" id="btn-send-notif"><i class="bi bi-send me-1"></i> إرسال إشعار جديد</button>
      </div>
    </div>
    <div class="row g-3">
      <div class="col-12">
        <div class="card">
          <div class="card-header"><i class="bi bi-clock-history me-2"></i> آخر الإشعارات المُرسلة</div>
          <div class="card-body p-0"><div id="notif-list" class="notification-list"></div></div>
        </div>
      </div>
    </div>
  `;
  const btn = $('#btn-send-notif');
  if (btn) btn.addEventListener('click', openSendNotifModal);
  // تأخير بسيط للتأكد من أن DOM جاهز
  setTimeout(renderNotifList, 10);
}

function renderNotifList() {
  const wrap = $('#notif-list');
  if (!wrap) return;
  const list = [...(CACHE.notifications || [])]
    .sort((a, b) => (toDate(b.createdAt) || 0) - (toDate(a.createdAt) || 0));
  if (list.length === 0) {
    wrap.innerHTML = `<div class="empty-state"><i class="bi bi-bell-slash"></i><h5>لا توجد إشعارات مرسلة</h5></div>`;
    return;
  }
  wrap.innerHTML = list.map(n => `
    <div class="notif-item">
      <div class="notif-icon ${n.audience === 'all' ? 'bg-accent-soft' : 'bg-info-soft'}" style="color:${n.audience === 'all' ? 'var(--color-accent)' : 'var(--color-info)'};">
        <i class="bi bi-${n.audience === 'all' ? 'people' : 'person'}"></i>
      </div>
      <div class="flex-grow-1">
        <div class="d-flex justify-content-between">
          <strong>${esc(n.title)}</strong>
          <small class="text-muted">${formatDate(n.createdAt, true)}</small>
        </div>
        <p class="mb-1 text-muted">${esc(n.body || '')}</p>
        <small class="text-muted">
          <i class="bi bi-check-circle text-success"></i>
          ${n.status === 'sent' ? 'تم الإرسال' : 'قيد الإرسال'}
          ${n.audience === 'all' ? '· لجميع المستخدمين' : '· لمستخدم محدد'}
        </small>
      </div>
      <button class="btn btn-icon btn-outline-danger notif-del-btn" data-id="${esc(n.id)}" title="حذف الإشعار" style="flex-shrink:0;width:32px;height:32px;"><i class="bi bi-trash"></i></button>
    </div>
  `).join('');
  wrap.querySelectorAll('.notif-del-btn').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const n = CACHE.notifications.find(x => x.id === id);
      if (!n) return;
      const ok = await confirmAction(`سيتم حذف الإشعار "${n.title}" نهائياً. هل أنت متأكد؟`, 'حذف الإشعار', 'حذف', 'danger');
      if (ok) {
        try {
          await remove('notifications', id);
          CACHE.notifications = CACHE.notifications.filter(x => x.id !== id);
          renderNotifList();
          showToast('تم حذف الإشعار', 'success');
        } catch (e) {
          showToast('تعذّر الحذف: ' + e.message, 'error');
        }
      }
    });
  });
}

function openSendNotifModal(prefill = null, prefillType = '', prefillLinkId = '') {
  const prefillTitle = prefill?.title || '';
  const prefillBody = prefill?.body || '';
  const bannerOpts = (CACHE.banners || []).map(b => `<option value="${esc(b.id)}" ${prefillLinkId === b.id ? 'selected' : ''}>${esc(b.titleAr || b.titleEn || 'بانر')}</option>`).join('');
  const productOpts = (CACHE.products || []).map(p => `<option value="${esc(p.id)}" ${prefillLinkId === p.id ? 'selected' : ''}>${esc(p.nameAr || p.nameEn || 'منتج')}</option>`).join('');
  const orderOpts = (CACHE.orders || []).map(o => `<option value="${esc(o.id)}" ${prefillLinkId === o.id ? 'selected' : ''}>#${esc(o.id.substring(0,8))} - ${esc(o.userName || o.userId || '')}</option>`).join('');
  const bodyHTML = `
    <form id="notif-form">
      <div class="mb-3">
        <label class="form-label">المستهدفون <span class="text-danger">*</span></label>
        <select class="form-select" name="audience" id="audience-sel" ${prefill ? 'disabled' : ''}>
          <option value="all">جميع المستخدمين</option>
          <option value="specific">مستخدم محدد</option>
        </select>
      </div>
      <div class="mb-3 d-none" id="user-field">
        <label class="form-label">اختر المستخدم</label>
        <select class="form-select" name="targetUserId" id="user-sel">
          <option value="">— اختر مستخدم —</option>
          ${CACHE.customers.map(c => `<option value="${esc(c.uid)}">${esc(c.displayName || 'عميل')} (${esc(c.email || '—')})</option>`).join('')}
        </select>
      </div>
      <div class="mb-3">
        <label class="form-label">عنوان الإشعار <span class="text-danger">*</span></label>
        <input type="text" class="form-control" name="title" required placeholder="مثال: عرض خاص لمدة 24 ساعة!" value="${esc(prefillTitle)}" />
      </div>
      <div class="mb-3">
        <label class="form-label">نص الإشعار <span class="text-danger">*</span></label>
        <textarea class="form-control" name="body" rows="4" required placeholder="اكتب نص الإشعار هنا...">${esc(prefillBody)}</textarea>
      </div>
      <div class="mb-3">
        <label class="form-label">نوع الإشعار</label>
        <select class="form-select" name="notifType" id="notif-type-sel">
          <option value="" ${prefillType === '' ? 'selected' : ''}>عام (يفتح الرئيسية)</option>
          <option value="campaign" ${prefillType === 'campaign' ? 'selected' : ''}>إعلان / بانر</option>
          <option value="product" ${prefillType === 'product' ? 'selected' : ''}>منتج</option>
          <option value="order" ${prefillType === 'order' ? 'selected' : ''}>طلب</option>
        </select>
      </div>
      <div class="mb-3 ${prefillType ? '' : 'd-none'}" id="notif-link-field">
        <label class="form-label" id="notif-link-label">${prefillType === 'campaign' ? 'اختر البانر' : prefillType === 'product' ? 'اختر المنتج' : prefillType === 'order' ? 'اختر الطلب' : 'رقم المعرف'}</label>
        <select class="form-select" name="notifLinkId" id="notif-link-id">
          <option value="">— اختر —</option>
          ${prefillType === 'campaign' ? bannerOpts : prefillType === 'product' ? productOpts : prefillType === 'order' ? orderOpts : ''}
        </select>
      </div>
    </form>
  `;
  closeModal('notif-modal');
  openModal({
    id: 'notif-modal',
    title: prefill ? 'إرسال إشعار الإعلان' : 'إرسال إشعار جديد',
    bodyHTML,
    submitText: 'إرسال الإشعار',
    onSubmit: async (modalEl) => {
      const form = modalEl.querySelector('#notif-form');
      if (!form.checkValidity()) { form.reportValidity(); return false; }
      const data = getFormData(form);
      if (data.audience === 'specific' && !data.targetUserId) {
        showToast('اختر مستخدمًا محددًا', 'error');
        return false;
      }
      const linkType = data.notifType || '';
      const linkId = data.notifLinkId || '';
      const notifData = linkType ? { type: linkType, id: linkId, click_action: 'FLUTTER_NOTIFICATION_CLICK' } : null;

      try {
        showToast('جاري حفظ الإشعار...', 'info', 2000);
        
        const payload = {
          title: data.title,
          body: data.body,
          audience: data.audience,
          targetUserId: data.audience === 'specific' ? data.targetUserId : '',
          status: 'pending',
          createdAt: serverTS(),
        };
        if (notifData) payload.data = notifData;
        
        const docRef = await db.collection('notifications').add(payload);
        
        if (!CACHE.notifications) CACHE.notifications = [];
        CACHE.notifications.unshift({ id: docRef.id, ...payload, createdAt: new Date() });
        
        showToast('تم حفظ الإشعار، سيتم إرساله تلقائياً قريباً', 'success');
        renderNotifList();
        return true;
      } catch (e) { showToast('خطأ: ' + e.message, 'error'); return false; }
    },
    onShown: (modalEl) => {
      const audSel = modalEl.querySelector('#audience-sel');
      const userField = modalEl.querySelector('#user-field');
      if (audSel && !audSel.disabled) {
        audSel.addEventListener('change', () => {
          if (audSel.value === 'specific' && userField) {
            userField.classList.remove('d-none');
            const select = userField.querySelector('select');
            if (select) select.required = true;
          } else if (userField) {
            userField.classList.add('d-none');
            const select = userField.querySelector('select');
            if (select) select.required = false;
          }
        });
      }
      const typeSel = modalEl.querySelector('#notif-type-sel');
      const linkField = modalEl.querySelector('#notif-link-field');
      const linkIdEl = modalEl.querySelector('#notif-link-id');
      const linkLabel = modalEl.querySelector('#notif-link-label');
      if (typeSel && linkField) {
        typeSel.addEventListener('change', () => {
          if (typeSel.value) {
            linkField.classList.remove('d-none');
            linkLabel.textContent = typeSel.value === 'campaign' ? 'اختر البانر' : typeSel.value === 'product' ? 'اختر المنتج' : 'اختر الطلب';
            const opts = typeSel.value === 'campaign' ? (CACHE.banners || []).map(b => `<option value="${esc(b.id)}">${esc(b.titleAr || b.titleEn || 'بانر')}</option>`)
              : typeSel.value === 'product' ? (CACHE.products || []).map(p => `<option value="${esc(p.id)}">${esc(p.nameAr || p.nameEn || 'منتج')}</option>`)
              : (CACHE.orders || []).map(o => `<option value="${esc(o.id)}">#${esc(o.id.substring(0,8))} - ${esc(o.userName || o.userId || '')}</option>`);
            linkIdEl.innerHTML = '<option value="">— اختر —</option>' + opts.join('');
          } else {
            linkField.classList.add('d-none');
            linkIdEl.innerHTML = '';
          }
        });
      }
    },
  });
}

/* =========================================================
   17) صفحة الإعدادات (Settings) — collection: `_meta/store_config`
   ========================================================= */

function renderSettings(container) {
  const s = CACHE.settings || {};
  container.innerHTML = `
    <div class="page-header">
      <div>
        <h1>الإعدادات</h1>
        <p class="page-subtitle">إدارة الإعدادات العامة للمتجر</p>
      </div>
      <div class="page-actions">
        <button class="btn btn-primary" id="btn-save-settings"><i class="bi bi-save me-1"></i> حفظ الإعدادات</button>
      </div>
    </div>
    <div id="settings-wrap">
      <div class="row g-3">
        <!-- معلومات المتجر -->
        <div class="col-12">
          <div class="card">
            <div class="card-header"><i class="bi bi-shop me-2"></i> معلومات المتجر</div>
            <div class="card-body">
              <div class="row g-3">
                <div class="col-md-6">
                  <div class="mb-3">
                    <label class="form-label">اسم المتجر (عربي)</label>
                    <input type="text" class="form-control" name="storeNameAr" value="${esc(s.storeNameAr || 'إلكترونيك')}" />
                  </div>
                </div>
                <div class="col-md-6">
                  <div class="mb-3">
                    <label class="form-label">اسم المتجر (إنجليزي)</label>
                    <input type="text" class="form-control" name="storeNameEn" dir="ltr" value="${esc(s.storeNameEn || 'Electronik')}" />
                  </div>
                </div>
                <div class="col-12">
                  <div class="mb-3">
                    <label class="form-label fw-bold">صورة الشعار (App Logo)</label>
                    <div class="image-uploader" id="s-logo-dropzone">
                      <i class="bi bi-cloud-arrow-up upload-icon"></i>
                      <p>اسحب الشعار هنا أو اضغط للاختيار من الجهاز</p>
                      <small>JPG, PNG, WebP, SVG — يتم تحويلها إلى WebP</small>
                      <input type="file" id="s-logo-input" accept="image/*" hidden />
                    </div>
                    <div class="image-preview-grid mt-3" id="s-logo-preview"></div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- معلومات التواصل -->
        <div class="col-12">
          <div class="card">
            <div class="card-header"><i class="bi bi-telephone me-2"></i> معلومات التواصل</div>
            <div class="card-body">
              <div class="row g-3">
                <div class="col-md-4">
                  <div class="mb-3">
                    <label class="form-label">الهاتف</label>
                    <input type="text" class="form-control" name="phone" value="${esc(s.phone || '')}" />
                  </div>
                </div>
                <div class="col-md-4">
                  <div class="mb-3">
                    <label class="form-label">البريد الإلكتروني</label>
                    <input type="email" class="form-control" name="email" value="${esc(s.email || '')}" />
                  </div>
                </div>
                <div class="col-md-4">
                  <div class="mb-3">
                    <label class="form-label">واتساب</label>
                    <input type="text" class="form-control" name="whatsapp" value="${esc(s.whatsapp || '')}" />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- روابط التواصل الاجتماعي -->
        <div class="col-12">
          <div class="card">
            <div class="card-header"><i class="bi bi-share me-2"></i> روابط التواصل الاجتماعي</div>
            <div class="card-body">
              <div class="row g-3">
                <div class="col-md-4">
                  <div class="mb-3">
                    <label class="form-label"><i class="bi bi-instagram me-1"></i> إنستغرام</label>
                    <input type="url" class="form-control" name="instagram" dir="ltr" value="${esc(s.instagram || '')}" />
                  </div>
                </div>
                <div class="col-md-4">
                  <div class="mb-3">
                    <label class="form-label"><i class="bi bi-twitter me-1"></i> تويتر / X</label>
                    <input type="url" class="form-control" name="twitter" dir="ltr" value="${esc(s.twitter || '')}" />
                  </div>
                </div>
                <div class="col-md-4">
                  <div class="mb-3">
                    <label class="form-label"><i class="bi bi-tiktok me-1"></i> تيك توك</label>
                    <input type="url" class="form-control" name="tiktok" dir="ltr" value="${esc(s.tiktok || '')}" />
                  </div>
                </div>
                <div class="col-md-4">
                  <div class="mb-3">
                    <label class="form-label"><i class="bi bi-youtube me-1"></i> يوتيوب</label>
                    <input type="url" class="form-control" name="youtube" dir="ltr" value="${esc(s.youtube || '')}" />
                  </div>
                </div>
                <div class="col-md-4">
                  <div class="mb-3">
                    <label class="form-label"><i class="bi bi-snapchat me-1"></i> سناب شات</label>
                    <input type="url" class="form-control" name="snapchat" dir="ltr" value="${esc(s.snapchat || '')}" />
                  </div>
                </div>
                <div class="col-md-4">
                  <div class="mb-3">
                    <label class="form-label"><i class="bi bi-facebook me-1"></i> فيسبوك</label>
                    <input type="url" class="form-control" name="facebook" dir="ltr" value="${esc(s.facebook || '')}" />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- العملات المتاحة -->
        <div class="col-12">
          <div class="card">
            <div class="card-header"><i class="bi bi-currency-exchange me-2"></i> العملات المتاحة للتطبيق</div>
            <div class="card-body">
              <div class="row g-3">
                ${[
                  { code: 'KWD', name: 'دينار كويتي', symbol: 'KD', flag: '🇰🇼' },
                  { code: 'AED', name: 'درهم إماراتي', symbol: 'AED', flag: '🇦🇪' },
                  { code: 'BHD', name: 'دينار بحريني', symbol: 'BD', flag: '🇧🇭' },
                  { code: 'QAR', name: 'ريال قطري', symbol: 'QR', flag: '🇶🇦' },
                  { code: 'OMR', name: 'ريال عماني', symbol: 'OMR', flag: '🇴🇲' },
                  { code: 'SAR', name: 'ريال سعودي', symbol: 'SR', flag: '🇸🇦' },
                  { code: 'USD', name: 'دولار أمريكي', symbol: '$', flag: '🇺🇸' },
                  { code: 'IQD', name: 'دينار عراقي', symbol: 'IQD', flag: '🇮🇶' },
                ].map(c => {
                  const enabledList = s.enabledCurrencies || ['KWD','AED','BHD','QAR','OMR','SAR','USD','IQD'];
                  const checked = enabledList.includes(c.code) ? 'checked' : '';
                  return `
                    <div class="col-md-3">
                      <div class="d-flex align-items-center gap-2 p-2 rounded" style="border:1px solid var(--border-color);background:var(--bg-surface);">
                        <span style="font-size:1.4rem;">${c.flag}</span>
                        <div class="flex-grow-1">
                          <div style="font-weight:600;font-size:0.85rem;">${c.name}</div>
                          <small class="text-muted">${c.code} - ${c.symbol}</small>
                        </div>
                        <div class="form-check form-switch m-0">
                          <input class="form-check-input currency-toggle" type="checkbox" data-code="${c.code}" ${checked} />
                        </div>
                      </div>
                    </div>
                  `;
                }).join('')}
              </div>
              <small class="text-muted mt-2 d-block">العملات المفعّلة ستظهر في تطبيق المستخدم. العملة الأساسية (KWD) لا يمكن إلغاؤها.</small>
            </div>
          </div>
        </div>

        <!-- إعدادات التوصيل -->
        <div class="col-12">
          <div class="card">
            <div class="card-header"><i class="bi bi-truck me-2"></i> إعدادات التوصيل</div>
            <div class="card-body">
              <div class="row g-3">
                <div class="col-md-4">
                  <div class="mb-3">
                    <label class="form-label">عدد أيام التوصيل المتاحة</label>
                    <input type="number" class="form-control" name="availableDaysCount" min="1" max="14" value="${s.availableDaysCount ?? 3}" />
                  </div>
                </div>
                <div class="col-md-4">
                  <div class="mb-3">
                    <label class="form-label">رسوم الشحن العادي</label>
                    <div class="input-group">
                      <input type="number" class="form-control" name="shippingFee" min="0" step="0.01" value="${s.shippingFee || 0}" />
                      <span class="input-group-text">KD</span>
                    </div>
                  </div>
                </div>
                <div class="col-md-4">
                  <div class="mb-3">
                    <label class="form-label">رسوم الشحن السريع</label>
                    <div class="input-group">
                      <input type="number" class="form-control" name="fastShippingFee" min="0" step="0.01" value="${s.fastShippingFee || 0}" />
                      <span class="input-group-text">KD</span>
                    </div>
                  </div>
                </div>
                <div class="col-md-4">
                  <div class="mb-3">
                    <label class="form-label">حد الشحن المجاني</label>
                    <div class="input-group">
                      <input type="number" class="form-control" name="freeShippingThreshold" min="0" step="0.01" value="${s.freeShippingThreshold || 0}" />
                      <span class="input-group-text">KD</span>
                    </div>
                  </div>
                </div>
                <div class="col-md-4">
                  <div class="mb-3">
                    <label class="form-label">وصف التوصيل العادي</label>
                    <input type="text" class="form-control" name="normalDescription" value="${esc(s.normalDescription ?? 'توصيل خلال 3-5 أيام')}" />
                  </div>
                </div>
                <div class="col-md-4">
                  <div class="mb-3">
                    <label class="form-label">وصف التوصيل السريع</label>
                    <input type="text" class="form-control" name="expressDescription" value="${esc(s.expressDescription ?? 'توصيل خلال 24 ساعة')}" />
                  </div>
                </div>
                <div class="col-md-6">
                  <div class="mb-3">
                    <label class="form-label">فترات التوصيل السريع</label>
                    <div class="input-group mb-2">
                      <input type="text" class="form-control" id="time-slot-input" placeholder="مثال: 2:00 م - 6:00 م" />
                      <button class="btn btn-outline-primary" type="button" id="add-time-slot">إضافة</button>
                    </div>
                    <div id="time-slots-list" class="d-flex flex-wrap gap-1">
                    </div>
                    <input type="hidden" name="expressTimeSlots" id="time-slots-input" value="" />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
    setTimeout(() => {
      // Build time slots badges from saved data
      const slotList = container.querySelector('#time-slots-list');
      const slotHidden = container.querySelector('#time-slots-input');
      if (!slotList || !slotHidden) return;
      function rebuildSlotHidden() {
        const slots = [...slotList.querySelectorAll('[data-slot]')].map(el => el.dataset.slot);
        slotHidden.value = slots.join('|');
      }
      function addSlotBadge(slotStr) {
        const badge = document.createElement('span');
        badge.className = 'badge bg-primary';
        badge.style.cursor = 'pointer';
        badge.dataset.slot = slotStr;
        badge.innerHTML = slotStr + ' <i class="bi bi-x"></i>';
        badge.addEventListener('click', () => { badge.remove(); rebuildSlotHidden(); });
        slotList.appendChild(badge);
      }
      (s.expressTimeSlots || []).forEach(addSlotBadge);
      rebuildSlotHidden();
      container.querySelector('#add-time-slot').addEventListener('click', () => {
        const input = container.querySelector('#time-slot-input');
        const val = input.value.trim();
        if (!val) return;
        if ([...slotList.querySelectorAll('[data-slot]')].some(el => el.dataset.slot === val)) return;
        addSlotBadge(val);
        input.value = '';
        rebuildSlotHidden();
      });
    }, 150);
    let logoUploaderRef = null;
  setTimeout(() => {
    if (document.querySelector('#s-logo-dropzone')) {
      logoUploaderRef = setupImageUploader(container, {
        mode: 'single',
        dropzoneId: 's-logo-dropzone',
        inputId: 's-logo-input',
        previewId: 's-logo-preview',
        existing: s.appLogoUrl ? [s.appLogoUrl] : [],
        maxWidth: 512,
        quality: 0.9,
      });
    }
  }, 100);

  $('#btn-save-settings').addEventListener('click', async () => {
    const wrap = $('#settings-wrap');
    const data = getFormData(wrap);
    if (logoUploaderRef) {
      const imgs = logoUploaderRef.getImages();
      data.appLogoUrl = imgs.length > 0 ? imgs[0] : '';
      if (data.appLogoUrl && data.appLogoUrl.startsWith('data:')) {
        try {
          data.appLogoUrl = await uploadImageToStorage(data.appLogoUrl, 'logos');
        } catch (e) {
          console.error('فشل رفع الشعار:', e);
        }
      }
    }
    const enabledCurrencies = [...wrap.querySelectorAll('.currency-toggle:checked')].map(cb => cb.dataset.code);
    if (!enabledCurrencies.includes('KWD')) enabledCurrencies.push('KWD');
    data.enabledCurrencies = enabledCurrencies;
    // معالجة إعدادات التوصيل
    data.availableDaysCount = Number(data.availableDaysCount) || 3;
    data.expressTimeSlots = (data.expressTimeSlots || '').split('|').filter(Boolean);
    try {
      await db.collection('_meta').doc('store_config').set({
        ...data,
        updatedAt: serverTS(),
      }, { merge: true });
      // حفظ إعدادات الشحن والتوصيل في المسار الذي يستخدمه تطبيق Flutter
      await db.collection('settings').doc('shipping').set({
        shippingCost: Number(data.shippingFee) || 0,
        fastShippingCost: Number(data.fastShippingFee) || 0,
        freeShippingThreshold: Number(data.freeShippingThreshold) || 0,
        availableDaysCount: data.availableDaysCount,
        normalDescription: data.normalDescription || 'توصيل خلال 3-5 أيام',
        expressDescription: data.expressDescription || 'توصيل خلال 24 ساعة',
        expressTimeSlots: data.expressTimeSlots,
        updatedAt: serverTS(),
      }, { merge: true });
      // حفظ رابط الشعار العام
      await db.collection('settings').doc('general').set({
        appLogoUrl: data.appLogoUrl || '',
        updatedAt: serverTS(),
      }, { merge: true });
      CACHE.settings = { ...CACHE.settings, ...data };
      showToast('تم حفظ الإعدادات بنجاح', 'success');
    } catch (e) {
      showToast('خطأ: ' + e.message, 'error');
    }
  });

}

/* =========================================================
   18) دوال مساعدة إضافية
   ========================================================= */

/**
 * إعداد حساب الأدمن - تُستدعى مرة واحدة فقط لإنشاء المستند في Firestore
 * الاستخدام من كونسول المتصفح:
 *   await setupAdminAccount('uid-من-firebase-auth', 'اسم المدير', 'admin@email.com')
 */
async function setupAdminAccount(uid, displayName = 'مدير النظام', email = '') {
  if (!uid) { console.error('أدخل الـ UID الصحيح'); return; }
  try {
    await db.collection('users').doc(uid).set({
      isAdmin: true,
      role: 'admin',
      isActive: true,
      displayName,
      email,
      createdAt: serverTS(),
    }, { merge: true });
    console.log('%c✅ تم إعداد حساب الأدمن بنجاح!', 'color:#10b981;font-weight:bold;font-size:16px;');
    console.log('يمكنك الآن تسجيل الدخول بالبريد وكلمة المرور التي أنشأتهما في Firebase Auth.');
  } catch (e) {
    console.error('❌ خطأ:', e.message);
  }
}
// اجعل الدالة متاحة globally لاستخدامها من Console
window.setupAdminAccount = setupAdminAccount;

/* =========================================================
   19) تهيئة التطبيق
   ========================================================= */

function registerAllRoutes() {
  registerRoute('dashboard', renderDashboard);
  registerRoute('products', renderProducts);
  registerRoute('categories', renderCategories);
  registerRoute('orders', renderOrders);
  registerRoute('customers', renderCustomers);
  registerRoute('coupons', renderCoupons);
  registerRoute('banners', renderBanners);
  registerRoute('reviews', renderReviews);
  registerRoute('notifications', renderNotifications);
  registerRoute('settings', renderSettings);
}

function initApp() {
  registerAllRoutes();
  window.addEventListener('hashchange', handleHashChange);

  // الاستماع لتغير حالة المصادقة
  auth.onAuthStateChanged(async (user) => {
    if (user) {
      try {
        const snap = await db.collection('users').doc(user.uid).get();
        const d = snap.exists ? snap.data() : {};
        if (d.isAdmin === true || d.role === 'admin') {
          currentAdmin = {
            uid: user.uid,
            email: user.email,
            displayName: d.displayName || user.email,
          };
          await startDashboard();
        } else {
          await auth.signOut();
          showToast('هذا الحساب ليس لديه صلاحية أدمن', 'error');
          showLoginView();
        }
      } catch (e) {
        console.error('[Auth] خطأ في التحقق:', e);
        showLoginView();
      }
    } else {
      showLoginView();
    }
  });
}

// بدء التطبيق
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}
