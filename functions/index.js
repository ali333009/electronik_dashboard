const functions = require('firebase-functions');
const admin = require('firebase-admin');
admin.initializeApp();

/**
 * Trigger: لما يتم إنشاء مستند جديد في collection notifications
 * بيتم إرسال FCM تلقائياً بناءً على حقل audience
 */
exports.onNotificationCreated = functions.firestore
  .document('notifications/{notifId}')
  .onCreate(async (snap, context) => {
    const data = snap.data();
    const { title, body, audience, targetUserId } = data;

    if (!title || !body) return null;

    const notification = { title, body };
    const androidConfig = {
      notification: { sound: 'default', channelId: 'order_channel' },
    };
    const apnsConfig = {
      payload: { aps: { sound: 'default' } },
    };

    try {
      if (audience === 'all') {
        await admin.messaging().send({
          topic: 'all',
          notification,
          android: androidConfig,
          apns: apnsConfig,
        });
      } else if (targetUserId) {
        const userDoc = await admin.firestore().collection('users').doc(targetUserId).get();
        if (userDoc.exists) {
          const userData = userDoc.data();
          const tokens = [];
          if (userData.fcmToken) tokens.push(userData.fcmToken);
          if (Array.isArray(userData.fcmTokens)) tokens.push(...userData.fcmTokens);
          const uniqueTokens = [...new Set(tokens.filter(Boolean))];

          if (uniqueTokens.length > 0) {
            await admin.messaging().sendEachForMulticast({
              tokens: uniqueTokens,
              notification,
              android: androidConfig,
              apns: apnsConfig,
            });
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
  const { title, body, target, audience, targetUserId, data: extraData } = data;

  if (!title || !body) {
    throw new functions.https.HttpsError('invalid-argument', 'title و body مطلوبان');
  }

  const notification = { title, body };
  const androidConfig = {
    notification: { sound: 'default', channelId: 'order_channel' },
  };
  const apnsConfig = {
    payload: { aps: { sound: 'default' } },
  };
  const msgData = extraData || {};

  if (!target || target === 'all') {
    await admin.messaging().send({
      topic: 'all',
      notification,
      android: androidConfig,
      apns: apnsConfig,
      data: msgData,
    });
  } else if (Array.isArray(target)) {
    const validTokens = target.filter(Boolean);
    if (validTokens.length === 0) {
      throw new functions.https.HttpsError('invalid-argument', 'لا توجد FCM tokens صالحة');
    }
    await admin.messaging().sendEachForMulticast({
      tokens: validTokens,
      notification,
      android: androidConfig,
      apns: apnsConfig,
      data: msgData,
    });
  } else if (target.startsWith('+') || target.startsWith('fcm') || target.startsWith('d')) {
    await admin.messaging().send({
      token: target,
      notification,
      android: androidConfig,
      apns: apnsConfig,
      data: msgData,
    });
  } else {
    const userDoc = await admin.firestore().collection('users').doc(target).get();
    if (userDoc.exists) {
      const userData = userDoc.data();
      const tokens = [];
      if (userData.fcmToken) tokens.push(userData.fcmToken);
      if (Array.isArray(userData.fcmTokens)) tokens.push(...userData.fcmTokens);
      const uniqueTokens = [...new Set(tokens.filter(Boolean))];

      if (uniqueTokens.length > 0) {
        await admin.messaging().sendEachForMulticast({
          tokens: uniqueTokens,
          notification,
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
    title,
    body,
    audience: audience || (target === 'all' ? 'all' : 'specific'),
    targetUserId: targetUserId || (target !== 'all' ? target : null),
    status: 'sent',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { success: true, id: notifRef.id };
});
