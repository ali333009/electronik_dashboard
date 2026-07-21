const functions = require('firebase-functions');
const admin = require('firebase-admin');
admin.initializeApp();

function pickLocalized(ar, en, lang) {
  if (lang === 'en' && en) return en;
  return ar || en || '';
}

/**
 * Trigger: لما يتم إنشاء مستند جديد في collection notifications
 * بيتم إرسال FCM تلقائياً بناءً على حقل audience
 * يدعم اللغتين (عربي / إنجليزي) بناءً على حقل appLanguage للمستخدم
 */
exports.onNotificationCreated = functions.firestore
  .document('notifications/{notifId}')
  .onCreate(async (snap, context) => {
    const data = snap.data();
    const { titleAr, titleEn, bodyAr, bodyEn, audience, targetUserId, title: legacyTitle, body: legacyBody } = data;

    const titleFallback = legacyTitle || titleAr || '';
    const bodyFallback = legacyBody || bodyAr || '';

    if (!titleFallback && !titleAr && !titleEn) return null;
    if (!bodyFallback && !bodyAr && !bodyEn) return null;

    const androidConfig = {
      notification: { sound: 'default', channelId: 'order_channel' },
    };
    const apnsConfig = {
      payload: { aps: { sound: 'default' } },
    };

    try {
      if (audience === 'all') {
        const usersSnap = await admin.firestore().collection('users').get();
        const tokenLangMap = [];

        usersSnap.forEach(doc => {
          const u = doc.data();
          const lang = u.appLanguage || 'ar';
          const tokens = [];
          if (u.fcmToken) tokens.push(u.fcmToken);
          if (Array.isArray(u.fcmTokens)) tokens.push(...u.fcmTokens);
          const uniqueTokens = [...new Set(tokens.filter(Boolean))];
          uniqueTokens.forEach(t => tokenLangMap.push({ token: t, lang }));
        });

        if (tokenLangMap.length > 0) {
          if (tokenLangMap.length === 1) {
            const { token, lang } = tokenLangMap[0];
            const title = pickLocalized(titleAr, titleEn, lang);
            const body = pickLocalized(bodyAr, bodyEn, lang);
            await admin.messaging().send({
              token,
              notification: { title, body },
              android: androidConfig,
              apns: apnsConfig,
            });
          } else {
            const messages = tokenLangMap.map(({ token, lang }) => ({
              token,
              notification: {
                title: pickLocalized(titleAr, titleEn, lang),
                body: pickLocalized(bodyAr, bodyEn, lang),
              },
              android: androidConfig,
              apns: apnsConfig,
            }));
            await admin.messaging().sendEachForMulticast({ tokens: messages.map(m => m.token), notification: messages[0].notification, android: androidConfig, apns: apnsConfig });
          }
        }
      } else if (targetUserId) {
        const userDoc = await admin.firestore().collection('users').doc(targetUserId).get();
        if (userDoc.exists) {
          const userData = userDoc.data();
          const lang = userData.appLanguage || 'ar';
          const tokens = [];
          if (userData.fcmToken) tokens.push(userData.fcmToken);
          if (Array.isArray(userData.fcmTokens)) tokens.push(...userData.fcmTokens);
          const uniqueTokens = [...new Set(tokens.filter(Boolean))];

          const title = pickLocalized(titleAr, titleEn, lang);
          const body = pickLocalized(bodyAr, bodyEn, lang);

          if (uniqueTokens.length > 0) {
            if (uniqueTokens.length === 1) {
              await admin.messaging().send({
                token: uniqueTokens[0],
                notification: { title, body },
                android: androidConfig,
                apns: apnsConfig,
              });
            } else {
              await admin.messaging().sendEachForMulticast({
                tokens: uniqueTokens,
                notification: { title, body },
                android: androidConfig,
                apns: apnsConfig,
              });
            }
          }
        }
      }

      await snap.ref.update({
        status: 'sent',
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    } catch (error) {
      console.error('FCM send error:', error);
      await snap.ref.update({
        status: 'failed',
        error: error.message,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }

    return null;
  });

/**
 * sendNotification — HTTPS Callable function (قديم، للتوافق)
 */
exports.sendNotification = functions.https.onCall(async (data, context) => {
  const { titleAr, titleEn, bodyAr, bodyEn, title: legacyTitle, body: legacyBody, target, audience, targetUserId, data: extraData } = data;

  const titleFallback = legacyTitle || titleAr || '';
  const bodyFallback = legacyBody || bodyAr || '';

  if (!titleFallback && !titleAr && !titleEn) {
    throw new functions.https.HttpsError('invalid-argument', 'title و body مطلوبان');
  }
  if (!bodyFallback && !bodyAr && !bodyEn) {
    throw new functions.https.HttpsError('invalid-argument', 'title و body مطلوبان');
  }

  const androidConfig = {
    notification: { sound: 'default', channelId: 'order_channel' },
  };
  const apnsConfig = {
    payload: { aps: { sound: 'default' } },
  };
  const msgData = extraData || {};

  const resolveNotif = (lang) => ({
    title: pickLocalized(titleAr, titleEn, lang),
    body: pickLocalized(bodyAr, bodyEn, lang),
  });

  if (!target || target === 'all') {
    const notif = resolveNotif('ar');
    await admin.messaging().send({
      topic: 'all',
      notification: notif,
      android: androidConfig,
      apns: apnsConfig,
      data: msgData,
    });
  } else if (Array.isArray(target)) {
    const validTokens = target.filter(Boolean);
    if (validTokens.length === 0) {
      throw new functions.https.HttpsError('invalid-argument', 'لا توجد FCM tokens صالحة');
    }
    const notif = resolveNotif('ar');
    await admin.messaging().sendEachForMulticast({
      tokens: validTokens,
      notification: notif,
      android: androidConfig,
      apns: apnsConfig,
      data: msgData,
    });
  } else if (target.startsWith('+') || target.startsWith('fcm') || target.startsWith('d')) {
    const notif = resolveNotif('ar');
    await admin.messaging().send({
      token: target,
      notification: notif,
      android: androidConfig,
      apns: apnsConfig,
      data: msgData,
    });
  } else {
    const userDoc = await admin.firestore().collection('users').doc(target).get();
    if (userDoc.exists) {
      const userData = userDoc.data();
      const lang = userData.appLanguage || 'ar';
      const tokens = [];
      if (userData.fcmToken) tokens.push(userData.fcmToken);
      if (Array.isArray(userData.fcmTokens)) tokens.push(...userData.fcmTokens);
      const uniqueTokens = [...new Set(tokens.filter(Boolean))];

      if (uniqueTokens.length > 0) {
        const notif = resolveNotif(lang);
        await admin.messaging().sendEachForMulticast({
          tokens: uniqueTokens,
          notification: notif,
          android: androidConfig,
          apns: apnsConfig,
          data: msgData,
        });
      }
    }
  }

  const notifRef = admin.firestore().collection('notifications').doc();
  await notifRef.set({
    id: notifRef.id,
    titleAr: titleAr || legacyTitle || '',
    titleEn: titleEn || '',
    bodyAr: bodyAr || legacyBody || '',
    bodyEn: bodyEn || '',
    title: titleAr || legacyTitle || titleEn || '',
    body: bodyAr || legacyBody || bodyEn || '',
    audience: audience || (target === 'all' ? 'all' : 'specific'),
    targetUserId: targetUserId || (target !== 'all' ? target : null),
    status: 'sent',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { success: true, id: notifRef.id };
});
