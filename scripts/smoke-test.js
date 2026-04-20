const http = require('http');
const assert = require('assert');

const app = require('../src/app');
const env = require('../src/config/env');
const { connectMySQLWithRetry, getPool } = require('../src/db/mysql');
const { createRedisClient, getRedis } = require('../src/db/redis');
const { initSchema } = require('../src/db/initSchema');

function requestJson({ port, method, path, token, body }) {
  return new Promise((resolve, reject) => {
    const payload = body ? Buffer.from(JSON.stringify(body)) : null;
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(payload ? { 'Content-Length': String(payload.length) } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        }
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let data = null;
          try {
            data = raw ? JSON.parse(raw) : null;
          } catch (error) {
            return reject(new Error(`Invalid JSON from ${method} ${path}: ${raw}`));
          }
          return resolve({ status: res.statusCode, data });
        });
      }
    );

    req.on('error', reject);
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

async function run() {
  await connectMySQLWithRetry();
  createRedisClient();
  await getRedis().ping();
  await initSchema();

  const server = await new Promise((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });
  const port = server.address().port;
  const pool = getPool();

  const randomSuffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const smokeUser = {
    username: `smoke_${randomSuffix}`.slice(0, 20),
    email: `smoke_${randomSuffix}@example.com`,
    password: 'smoke123456'
  };
  const peerUser = {
    username: `peer_${randomSuffix}`.slice(0, 20),
    email: `peer_${randomSuffix}@example.com`,
    password: 'smoke123456'
  };

  let createdPostId = null;
  let createdMarketplaceId = null;
  let createdUserId = null;
  let peerUserId = null;
  let createdActivityId = null;
  let createdConversationId = null;
  let createdCommentId = null;
  let pendingActivityId = null;
  let pendingVenueName = null;

  try {
    const bootstrap = await requestJson({ port, method: 'GET', path: '/api/forum/bootstrap' });
    assert.strictEqual(bootstrap.status, 200, 'bootstrap status should be 200');
    assert.ok(bootstrap.data?.hero?.overview, 'bootstrap should return hero overview');
    assert.strictEqual(bootstrap.data?.tabs?.length > 0, true, 'bootstrap should return nav tabs');

    const register = await requestJson({
      port,
      method: 'POST',
      path: '/api/auth/register',
      body: smokeUser
    });
    assert.strictEqual(register.status, 201, 'register status should be 201');
    createdUserId = register.data?.id;

    const registerPeer = await requestJson({
      port,
      method: 'POST',
      path: '/api/auth/register',
      body: peerUser
    });
    assert.strictEqual(registerPeer.status, 201, 'peer register status should be 201');
    peerUserId = registerPeer.data?.id;

    const login = await requestJson({
      port,
      method: 'POST',
      path: '/api/auth/login',
      body: { account: smokeUser.username, password: smokeUser.password }
    });
    assert.strictEqual(login.status, 200, 'login status should be 200');
    assert.ok(login.data?.token, 'login should return token');
    const token = login.data.token;

    const peerLogin = await requestJson({
      port,
      method: 'POST',
      path: '/api/auth/login',
      body: { account: peerUser.username, password: peerUser.password }
    });
    assert.strictEqual(peerLogin.status, 200, 'peer login status should be 200');
    assert.ok(peerLogin.data?.token, 'peer login should return token');
    const peerToken = peerLogin.data.token;

    const me = await requestJson({ port, method: 'GET', path: '/api/auth/me', token });
    assert.strictEqual(me.status, 200, 'me status should be 200');
    assert.strictEqual(me.data?.user?.username, smokeUser.username, 'me should return created user');

    await pool.execute('UPDATE users SET level = ? WHERE id = ?', [5, createdUserId]);
    await pool.execute('UPDATE users SET level = ? WHERE id = ?', [5, peerUserId]);
    const [userLevelRows] = await pool.execute(
      'SELECT id, level, role FROM users WHERE id IN (?, ?) ORDER BY id ASC',
      [createdUserId, peerUserId]
    );
    assert.ok(userLevelRows.every((item) => Number(item.level) === 5), 'both smoke users should be level 5 before activity tests');

    const createPost = await requestJson({
      port,
      method: 'POST',
      path: '/api/forum/posts',
      token,
      body: {
        title: 'Smoke Test Post',
        category: '技术讨论',
        contentType: '纯文字',
        city: '上海',
        summary: '这是一条用于后端关键链路验证的 smoke test 帖子摘要。',
        content: '这是一条用于后端关键链路验证的 smoke test 帖子正文，长度足够通过校验并验证详情页接口。'
      }
    });
    assert.strictEqual(createPost.status, 201, 'create post status should be 201');
    createdPostId = createPost.data?.id;

    const postDetail = await requestJson({
      port,
      method: 'GET',
      path: `/api/forum/posts/${createdPostId}`,
      token
    });
    assert.strictEqual(postDetail.status, 200, 'post detail status should be 200');
    assert.strictEqual(postDetail.data?.post?.title, 'Smoke Test Post', 'post detail should match created post');

    const createComment = await requestJson({
      port,
      method: 'POST',
      path: `/api/forum/posts/${createdPostId}/comments`,
      token,
      body: {
        content: '这是一条 smoke test 评论，用于验证举报和批量治理链路。'
      }
    });
    assert.strictEqual(createComment.status, 201, 'create comment status should be 201');
    createdCommentId = createComment.data?.comment?.id;
    assert.ok(createdCommentId, 'create comment should return comment id');

    const reportComment = await requestJson({
      port,
      method: 'POST',
      path: `/api/forum/posts/${createdPostId}/comments/${createdCommentId}/report`,
      token: peerToken
    });
    assert.strictEqual(reportComment.status, 200, 'report comment status should be 200');

    const dashboard = await requestJson({
      port,
      method: 'GET',
      path: '/api/forum/me/dashboard',
      token
    });
    assert.strictEqual(dashboard.status, 200, 'dashboard status should be 200');
    assert.ok(Array.isArray(dashboard.data?.notifications), 'dashboard should return notifications');

    await pool.execute('UPDATE users SET role = ?, level = ? WHERE id = ?', ['admin', 5, createdUserId]);
    const [promotedUserRows] = await pool.execute('SELECT id, level, role FROM users WHERE id = ? LIMIT 1', [createdUserId]);
    assert.strictEqual(promotedUserRows[0]?.role, 'admin', 'primary smoke user should be promoted to admin');
    assert.strictEqual(Number(promotedUserRows[0]?.level || 0), 5, 'primary smoke user should keep level 5 after promotion');

    const now = Date.now();
    const createActivity = await requestJson({
      port,
      method: 'POST',
      path: '/api/forum/activities',
      token,
      body: {
        title: 'Smoke Test Activity',
        type: '双打娱乐局',
        city: '上海',
        venueName: 'Smoke 羽球馆',
        address: '上海市浦东新区测试路 88 号',
        startTime: new Date(now + 3 * 24 * 60 * 60 * 1000).toISOString(),
        signupDeadline: new Date(now + 2 * 24 * 60 * 60 * 1000).toISOString(),
        capacity: 8,
        levelLimit: 1,
        summary: '这是一场用于 smoke test 的活动，用来验证活动详情、报名、评论与通知流程。'
      }
    });
    assert.strictEqual(createActivity.status, 201, 'activity create status should be 201');
    createdActivityId = createActivity.data?.id;

    const registerActivity = await requestJson({
      port,
      method: 'POST',
      path: `/api/forum/activities/${createdActivityId}/register`,
      token
    });
    assert.strictEqual(registerActivity.status, 201, 'activity register status should be 201');

    const activityDetail = await requestJson({
      port,
      method: 'GET',
      path: `/api/forum/activities/${createdActivityId}`,
      token
    });
    assert.strictEqual(activityDetail.status, 200, 'activity detail status should be 200');
    assert.strictEqual(activityDetail.data?.activity?.isJoined, true, 'activity detail should reflect joined state');

    const activityComment = await requestJson({
      port,
      method: 'POST',
      path: `/api/forum/activities/${createdActivityId}/comments`,
      token,
      body: {
        content: '这是一条 smoke test 活动评论，用于验证评论发布与详情关联链路。'
      }
    });
    assert.strictEqual(activityComment.status, 201, 'activity comment status should be 201');
    assert.ok(activityComment.data?.comment?.id, 'activity comment should return created comment');

    await pool.execute('UPDATE activities SET start_time = ? WHERE id = ?', [
      new Date(now - 2 * 60 * 60 * 1000),
      createdActivityId
    ]);

    const activityFeedback = await requestJson({
      port,
      method: 'POST',
      path: `/api/forum/activities/${createdActivityId}/feedback`,
      token,
      body: {
        rating: 5,
        content: '这是一条 smoke test 活动评价，用于验证活动评价提交流程。'
      }
    });
    assert.strictEqual(activityFeedback.status, 201, 'activity feedback status should be 201');
    assert.strictEqual(activityFeedback.data?.feedback?.rating, 5, 'activity feedback should return rating');

    const dashboardAfterActivity = await requestJson({
      port,
      method: 'GET',
      path: '/api/forum/me/dashboard',
      token
    });
    assert.strictEqual(dashboardAfterActivity.status, 200, 'dashboard after activity should be 200');
    assert.ok(
      (dashboardAfterActivity.data?.notifications || []).some((item) => item.title === '活动报名成功'),
      'dashboard should include activity success notification'
    );

    const unreadNotification = (dashboardAfterActivity.data?.notifications || []).find((item) => Number(item.isRead) === 0);
    assert.ok(unreadNotification, 'dashboard should include unread notification');

    const readNotification = await requestJson({
      port,
      method: 'POST',
      path: `/api/forum/notifications/${unreadNotification.id}/read`,
      token
    });
    assert.strictEqual(readNotification.status, 200, 'mark notification read should be 200');

    const readAllNotifications = await requestJson({
      port,
      method: 'POST',
      path: '/api/forum/notifications/read-all',
      token
    });
    assert.strictEqual(readAllNotifications.status, 200, 'mark all notifications read should be 200');

    const cancelActivity = await requestJson({
      port,
      method: 'DELETE',
      path: `/api/forum/activities/${createdActivityId}/register`,
      token
    });
    assert.strictEqual(cancelActivity.status, 200, 'activity cancel status should be 200');

    const clearReadNotifications = await requestJson({
      port,
      method: 'DELETE',
      path: '/api/forum/notifications/read',
      token
    });
    assert.strictEqual(clearReadNotifications.status, 200, 'clear read notifications should be 200');
    assert.ok(
      typeof clearReadNotifications.data?.cleared === 'number',
      'clear read notifications should return cleared count'
    );

    const createPendingActivity = await requestJson({
      port,
      method: 'POST',
      path: '/api/forum/activities',
      token: peerToken,
      body: {
        title: 'Peer Pending Activity',
        type: '单打训练局',
        city: '上海',
        venueName: '待审球馆',
        address: '上海市徐汇区待审路 66 号',
        startTime: new Date(now + 5 * 24 * 60 * 60 * 1000).toISOString(),
        signupDeadline: new Date(now + 4 * 24 * 60 * 60 * 1000).toISOString(),
        capacity: 6,
        levelLimit: 2,
        summary: '这是一条由普通用户创建的待审活动，用于验证批量活动审核。'
      }
    });
    assert.strictEqual(createPendingActivity.status, 201, 'peer pending activity create status should be 201');
    assert.strictEqual(createPendingActivity.data?.reviewStatus, 'pending', 'peer activity should be pending');
    pendingActivityId = createPendingActivity.data?.id;

    pendingVenueName = `Smoke Venue ${randomSuffix}`;
    const createVenueSubmission = await requestJson({
      port,
      method: 'POST',
      path: '/api/forum/venues/submissions',
      token: peerToken,
      body: {
        city: '上海',
        name: pendingVenueName,
        address: '上海市闵行区提报路 99 号',
        businessHours: '09:00-22:00',
        priceRange: '60-90 元/小时',
        note: '这是一条 smoke test 场馆提报，用于验证批量审核链路。'
      }
    });
    assert.strictEqual(createVenueSubmission.status, 201, 'venue submission create status should be 201');

    const createMarketplace = await requestJson({
      port,
      method: 'POST',
      path: '/api/forum/marketplace',
      token,
      body: {
        type: '出售',
        category: '羽毛球拍',
        title: 'Smoke Marketplace Item',
        conditionLevel: '9 成新',
        price: 666,
        city: '上海',
        summary: '用于 smoke test 的交易信息，验证详情和状态更新链路。',
        imageUrls: ['https://example.com/smoke-item.jpg']
      }
    });
    assert.strictEqual(createMarketplace.status, 201, 'create marketplace status should be 201');
    createdMarketplaceId = createMarketplace.data?.id;

    const marketplaceDetail = await requestJson({
      port,
      method: 'GET',
      path: `/api/forum/marketplace/${createdMarketplaceId}`,
      token
    });
    assert.strictEqual(marketplaceDetail.status, 200, 'marketplace detail status should be 200');
    assert.strictEqual(marketplaceDetail.data?.item?.title, 'Smoke Marketplace Item', 'marketplace detail should match created item');

    const marketplaceComment = await requestJson({
      port,
      method: 'POST',
      path: `/api/forum/marketplace/${createdMarketplaceId}/comments`,
      token,
      body: {
        content: '这是一条 smoke test 交易咨询，用于验证详情页咨询链路。'
      }
    });
    assert.strictEqual(marketplaceComment.status, 201, 'marketplace comment status should be 201');
    assert.ok(marketplaceComment.data?.comment?.id, 'marketplace comment should return created comment');

    const createConversation = await requestJson({
      port,
      method: 'POST',
      path: '/api/forum/messages/conversations',
      token: peerToken,
      body: {
        targetUserId: createdUserId,
        contextType: 'marketplace',
        contextId: createdMarketplaceId
      }
    });
    assert.strictEqual(createConversation.status, 201, 'create conversation status should be 201');
    createdConversationId = createConversation.data?.conversation?.id;
    assert.ok(createdConversationId, 'conversation id should exist');
    assert.strictEqual(
      createConversation.data?.conversation?.contextType,
      'marketplace',
      'conversation should bind marketplace context'
    );

    const sendMessage = await requestJson({
      port,
      method: 'POST',
      path: `/api/forum/messages/${createdConversationId}`,
      token: peerToken,
      body: {
        content: '这是一条 smoke test 私信，用于验证交易会话发送链路。'
      }
    });
    assert.strictEqual(sendMessage.status, 201, 'send message status should be 201');
    assert.ok(sendMessage.data?.entry?.id, 'send message should return entry id');

    const fetchConversation = await requestJson({
      port,
      method: 'GET',
      path: `/api/forum/messages/${createdConversationId}`,
      token
    });
    assert.strictEqual(fetchConversation.status, 200, 'fetch conversation detail status should be 200');
    assert.ok(Array.isArray(fetchConversation.data?.messages), 'conversation detail should return messages');
    assert.ok(
      (fetchConversation.data?.messages || []).some((item) => item.content.includes('smoke test 私信')),
      'conversation detail should include the sent message'
    );

    const fetchConversations = await requestJson({
      port,
      method: 'GET',
      path: '/api/forum/messages',
      token
    });
    assert.strictEqual(fetchConversations.status, 200, 'fetch conversations status should be 200');
    assert.ok(
      (fetchConversations.data?.conversations || []).some((item) => item.id === createdConversationId),
      'conversation list should include created conversation'
    );

    const batchApproveActivities = await requestJson({
      port,
      method: 'POST',
      path: '/api/forum/admin/activities/batch',
      token,
      body: { action: 'approve' }
    });
    assert.strictEqual(batchApproveActivities.status, 200, 'batch approve activities status should be 200');

    const [approvedActivityRows] = await pool.execute(
      'SELECT review_status AS reviewStatus FROM activities WHERE id = ? LIMIT 1',
      [pendingActivityId]
    );
    assert.strictEqual(approvedActivityRows[0]?.reviewStatus, 'approved', 'pending activity should be approved');

    const batchDeleteCommentReports = await requestJson({
      port,
      method: 'POST',
      path: '/api/forum/admin/comment-reports/batch',
      token,
      body: { action: 'delete_comment' }
    });
    assert.strictEqual(batchDeleteCommentReports.status, 200, 'batch delete comment reports status should be 200');

    const [deletedCommentRows] = await pool.execute(
      'SELECT deleted_at AS deletedAt, content FROM post_comments WHERE id = ? LIMIT 1',
      [createdCommentId]
    );
    assert.ok(deletedCommentRows[0]?.deletedAt, 'reported comment should be marked deleted');
    assert.strictEqual(deletedCommentRows[0]?.content, '该评论已因违规被移除', 'reported comment content should be replaced');

    const [remainingReportRows] = await pool.execute('SELECT COUNT(*) AS count FROM comment_reports');
    assert.strictEqual(Number(remainingReportRows[0]?.count || 0), 0, 'comment reports should be cleared after batch handling');

    const batchApproveVenueSubmissions = await requestJson({
      port,
      method: 'POST',
      path: '/api/forum/admin/venue-submissions/batch',
      token,
      body: { action: 'approve' }
    });
    assert.strictEqual(batchApproveVenueSubmissions.status, 200, 'batch approve venue submissions status should be 200');

    const [approvedVenueRows] = await pool.execute(
      'SELECT status FROM venue_submissions WHERE name = ? ORDER BY id DESC LIMIT 1',
      [pendingVenueName]
    );
    assert.strictEqual(approvedVenueRows[0]?.status, 'approved', 'venue submission should be approved');

    const [insertedVenueRows] = await pool.execute(
      'SELECT id FROM venues WHERE name = ? ORDER BY id DESC LIMIT 1',
      [pendingVenueName]
    );
    assert.ok(insertedVenueRows[0]?.id, 'approved venue submission should create venue');

    const marketplaceStatus = await requestJson({
      port,
      method: 'PUT',
      path: `/api/forum/marketplace/${createdMarketplaceId}/status`,
      token,
      body: { status: 'completed' }
    });
    assert.strictEqual(marketplaceStatus.status, 200, 'marketplace status update should be 200');
    const moderation = await requestJson({
      port,
      method: 'GET',
      path: '/api/forum/admin/moderation',
      token
    });
    assert.strictEqual(moderation.status, 200, 'moderation dashboard status should be 200');
    assert.ok(moderation.data?.stats, 'moderation should return stats');

    const hidePost = await requestJson({
      port,
      method: 'POST',
      path: `/api/forum/admin/posts/${createdPostId}`,
      token,
      body: { action: 'hide' }
    });
    assert.strictEqual(hidePost.status, 200, 'admin hide post should be 200');

    const restoreMarketplace = await requestJson({
      port,
      method: 'POST',
      path: `/api/forum/admin/marketplace/${createdMarketplaceId}`,
      token,
      body: { action: 'restore' }
    });
    assert.strictEqual(restoreMarketplace.status, 200, 'admin restore marketplace should be 200');

    console.log('[smoke] backend critical path checks passed');
  } finally {
    if (createdPostId) {
      await pool.execute('DELETE FROM posts WHERE id = ?', [createdPostId]);
    }
    if (createdCommentId) {
      await pool.execute('DELETE FROM comment_reports WHERE comment_id = ?', [createdCommentId]);
      await pool.execute('DELETE FROM post_comments WHERE id = ?', [createdCommentId]);
    }
    if (createdMarketplaceId) {
      await pool.execute('DELETE FROM marketplace_comments WHERE item_id = ?', [createdMarketplaceId]);
      await pool.execute('DELETE FROM marketplace_items WHERE id = ?', [createdMarketplaceId]);
    }
    if (createdConversationId) {
      await pool.execute('DELETE FROM message_entries WHERE conversation_id = ?', [createdConversationId]);
      await pool.execute('DELETE FROM message_conversations WHERE id = ?', [createdConversationId]);
    }
    if (createdActivityId) {
      await pool.execute('DELETE FROM activity_feedback WHERE activity_id = ?', [createdActivityId]);
      await pool.execute('DELETE FROM activity_comments WHERE activity_id = ?', [createdActivityId]);
      await pool.execute('DELETE FROM activity_registrations WHERE activity_id = ?', [createdActivityId]);
      await pool.execute('DELETE FROM activities WHERE id = ?', [createdActivityId]);
    }
    if (pendingActivityId) {
      await pool.execute('DELETE FROM activity_feedback WHERE activity_id = ?', [pendingActivityId]);
      await pool.execute('DELETE FROM activity_comments WHERE activity_id = ?', [pendingActivityId]);
      await pool.execute('DELETE FROM activity_registrations WHERE activity_id = ?', [pendingActivityId]);
      await pool.execute('DELETE FROM activities WHERE id = ?', [pendingActivityId]);
    }
    if (pendingVenueName) {
      await pool.execute('DELETE FROM venues WHERE name = ?', [pendingVenueName]);
      await pool.execute('DELETE FROM venue_submissions WHERE name = ?', [pendingVenueName]);
    }
    if (createdUserId) {
      await pool.execute('DELETE FROM activity_feedback WHERE user_id = ?', [createdUserId]);
      await pool.execute('DELETE FROM activity_comments WHERE user_id = ?', [createdUserId]);
      await pool.execute('DELETE FROM activity_registrations WHERE user_id = ?', [createdUserId]);
      await pool.execute('DELETE FROM activity_penalties WHERE user_id = ?', [createdUserId]);
      await pool.execute('DELETE FROM marketplace_comments WHERE user_id = ?', [createdUserId]);
      await pool.execute('DELETE FROM venue_submissions WHERE user_id = ?', [createdUserId]);
      await pool.execute('DELETE FROM message_entries WHERE sender_id = ?', [createdUserId]);
      await pool.execute('DELETE FROM message_conversations WHERE user_low_id = ? OR user_high_id = ?', [createdUserId, createdUserId]);
      await pool.execute('DELETE FROM notifications WHERE user_id = ?', [createdUserId]);
      await pool.execute('DELETE FROM post_drafts WHERE user_id = ?', [createdUserId]);
      await pool.execute('DELETE FROM users WHERE id = ?', [createdUserId]);
    }
    if (peerUserId) {
      await pool.execute('DELETE FROM marketplace_comments WHERE user_id = ?', [peerUserId]);
      await pool.execute('DELETE FROM venue_submissions WHERE user_id = ?', [peerUserId]);
      await pool.execute('DELETE FROM message_entries WHERE sender_id = ?', [peerUserId]);
      await pool.execute('DELETE FROM message_conversations WHERE user_low_id = ? OR user_high_id = ?', [peerUserId, peerUserId]);
      await pool.execute('DELETE FROM notifications WHERE user_id = ?', [peerUserId]);
      await pool.execute('DELETE FROM post_drafts WHERE user_id = ?', [peerUserId]);
      await pool.execute('DELETE FROM users WHERE id = ?', [peerUserId]);
    }
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    try {
      await getRedis().quit();
    } catch (_error) {
      // ignore redis shutdown issues in smoke mode
    }
    try {
      await pool.end();
    } catch (_error) {
      // ignore mysql shutdown issues in smoke mode
    }
  }
}

run().catch((error) => {
  console.error('[smoke] failed:', error.message);
  process.exit(1);
});
