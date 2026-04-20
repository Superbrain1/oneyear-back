const express = require('express');
const { z } = require('zod');
const { getPool } = require('../db/mysql');
const { getAuthUser, requireAuth } = require('../utils/auth');

const router = express.Router();

const createPostSchema = z.object({
  title: z.string().trim().min(4).max(160),
  category: z.string().trim().min(2).max(40),
  contentType: z.enum(['图文', '视频', '纯文字']),
  city: z.string().trim().min(2).max(40),
  summary: z.string().trim().min(10).max(255),
  content: z.string().trim().min(20).max(5000)
});

const savePostDraftSchema = z.object({
  draftId: z.number().int().positive().optional(),
  title: z.string().trim().max(160).optional().default(''),
  category: z.string().trim().max(40).optional().default('技术讨论'),
  contentType: z.enum(['图文', '视频', '纯文字']).optional().default('图文'),
  city: z.string().trim().max(40).optional().default('上海'),
  summary: z.string().trim().max(255).optional().default(''),
  content: z.string().trim().max(5000).optional().default('')
});

const createCommentSchema = z.object({
  content: z.string().trim().min(2).max(1000),
  parentId: z.number().int().positive().optional()
});

const createActivitySchema = z.object({
  title: z.string().trim().min(4).max(160),
  type: z.string().trim().min(2).max(40),
  city: z.string().trim().min(2).max(40),
  venueName: z.string().trim().min(2).max(80),
  address: z.string().trim().min(6).max(160),
  startTime: z.string().datetime(),
  signupDeadline: z.string().datetime(),
  capacity: z.number().int().min(2).max(200),
  levelLimit: z.number().int().min(1).max(10),
  summary: z.string().trim().min(10).max(255)
});

const createActivityCommentSchema = z.object({
  content: z.string().trim().min(2).max(1000)
});

const createActivityFeedbackSchema = z.object({
  rating: z.number().int().min(1).max(5),
  content: z.string().trim().min(4).max(1000)
});

const createNewsCommentSchema = z.object({
  content: z.string().trim().min(2).max(1000)
});

const createMatchCommentSchema = z.object({
  content: z.string().trim().min(2).max(1000)
});

const createVenueReviewSchema = z.object({
  rating: z.number().int().min(1).max(5),
  content: z.string().trim().min(2).max(1000)
});

const createVenueSubmissionSchema = z.object({
  city: z.string().trim().min(2).max(40),
  name: z.string().trim().min(2).max(80),
  address: z.string().trim().min(6).max(160),
  businessHours: z.string().trim().min(2).max(80),
  priceRange: z.string().trim().min(2).max(80),
  note: z.string().trim().min(4).max(255)
});

const moderateCommentReportSchema = z.object({
  action: z.enum(['dismiss', 'delete_comment'])
});

const moderateVenueSubmissionSchema = z.object({
  action: z.enum(['approve', 'reject'])
});

const moderateBatchSchema = z.object({
  action: z.enum(['approve', 'reject', 'dismiss', 'delete_comment'])
});

const moderateVisibilitySchema = z.object({
  action: z.enum(['hide', 'restore'])
});

const manageActivitySchema = z.object({
  status: z.enum(['published', 'closed']).optional(),
  reviewStatus: z.enum(['pending', 'approved', 'rejected']).optional()
});

const createMarketplaceSchema = z.object({
  type: z.enum(['出售', '求购']),
  category: z.string().trim().min(2).max(40),
  title: z.string().trim().min(4).max(160),
  conditionLevel: z.string().trim().min(2).max(40),
  price: z.number().positive().max(999999),
  city: z.string().trim().min(2).max(40),
  summary: z.string().trim().min(10).max(255),
  imageUrls: z.array(z.string().trim().min(1).max(65535)).max(3).optional(),
  imageUrl: z.string().trim().max(65535).optional().or(z.literal(''))
});

const createMarketplaceCommentSchema = z.object({
  content: z.string().trim().min(2).max(1000)
});

const updateProfileSchema = z.object({
  city: z.string().trim().min(2).max(40),
  bio: z.string().trim().min(4).max(255)
});

const createConversationSchema = z.object({
  targetUserId: z.number().int().positive(),
  contextType: z.enum(['direct', 'marketplace']).default('direct'),
  contextId: z.number().int().positive().optional()
});

const createMessageSchema = z.object({
  content: z.string().trim().min(1).max(1000)
});

function computeHeat(item) {
  return Math.round(item.views * 0.2 + item.commentsCount * 0.5 + item.likesCount * 0.3);
}

function levelTitle(level) {
  const titles = ['新手球友', '热身选手', '稳定入门', '跃升选手', '进阶选手', '城市主力', '战术核心', '硬核球友', '板块骨干', '传奇馆主'];
  return titles[level - 1] || `等级 ${level}`;
}

function levelBenefits(level) {
  if (level <= 3) {
    return '可发布普通帖子与参与评论互动';
  }
  if (level <= 6) {
    return '可发布活动帖子，获得更高内容曝光';
  }
  if (level <= 8) {
    return '可申请活动协办、参与同城推荐位';
  }
  return '可申请板块管理员，参与社区治理';
}

function levelBadge(level) {
  const badges = [
    '初羽徽章',
    '热身徽章',
    '入门徽章',
    '跃升徽章',
    '进阶徽章',
    '主力徽章',
    '核心徽章',
    '硬核徽章',
    '骨干徽章',
    '馆主徽章'
  ];
  return badges[level - 1] || `Lv.${level} 勋章`;
}

function toRelativeTime(value) {
  const diff = Date.now() - new Date(value).getTime();
  const hour = 1000 * 60 * 60;
  const day = hour * 24;
  if (diff < hour) {
    return `${Math.max(1, Math.floor(diff / (1000 * 60)))} 分钟前`;
  }
  if (diff < day) {
    return `${Math.floor(diff / hour)} 小时前`;
  }
  return `${Math.floor(diff / day)} 天前`;
}

function normalizeImageUrls(payload) {
  const source = [];
  if (Array.isArray(payload?.imageUrls)) {
    source.push(...payload.imageUrls);
  }
  if (typeof payload?.imageUrl === 'string' && payload.imageUrl.trim()) {
    source.push(...payload.imageUrl.split(/\r?\n|,/g));
  }

  return source
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .slice(0, 3);
}

function mapMarketplaceImages(value) {
  const imageUrls = String(value || '')
    .split(/\r?\n/g)
    .map((item) => item.trim())
    .filter(Boolean);

  return {
    imageUrl: imageUrls[0] || '',
    imageUrls
  };
}

async function awardUserExp(pool, userId, actionType, deltaExp, description) {
  if (!deltaExp) {
    return null;
  }

  const [rows] = await pool.execute(
    'SELECT id, level, exp FROM users WHERE id = ? LIMIT 1',
    [userId]
  );
  const user = rows[0];
  if (!user) {
    return null;
  }

  const nextExp = Math.max(0, Number(user.exp || 0) + Number(deltaExp || 0));
  const nextLevel = Math.min(10, Math.max(1, Math.floor(nextExp / 120) + 1));
  await pool.execute('UPDATE users SET exp = ?, level = ? WHERE id = ?', [nextExp, nextLevel, userId]);
  await pool.execute(
    'INSERT INTO exp_logs (user_id, action_type, delta_exp, description) VALUES (?, ?, ?, ?)',
    [userId, actionType, deltaExp, description]
  );
  if (nextLevel > user.level) {
    await pool.execute(
      'INSERT INTO level_records (user_id, previous_level, next_level) VALUES (?, ?, ?)',
      [userId, user.level, nextLevel]
    );
  }

  return {
    previousLevel: user.level,
    nextLevel,
    nextExp
  };
}

async function syncTaskProgress(pool, userId, taskType, increment = 1) {
  const [taskRows] = await pool.execute(
    `SELECT id, title, target_count AS targetCount, reward_exp AS rewardExp
    FROM level_tasks
    WHERE task_type = ? AND is_active = 1`,
    [taskType]
  );

  for (const task of taskRows) {
    const [progressRows] = await pool.execute(
      `SELECT id, progress_count AS progressCount, is_completed AS isCompleted
      FROM user_task_progress
      WHERE user_id = ? AND task_id = ?
      LIMIT 1`,
      [userId, task.id]
    );
    const progress = progressRows[0];
    if (!progress) {
      const nextCount = increment;
      const completed = nextCount >= task.targetCount ? 1 : 0;
      await pool.execute(
        `INSERT INTO user_task_progress (user_id, task_id, progress_count, is_completed, completed_at)
        VALUES (?, ?, ?, ?, ?)`,
        [userId, task.id, nextCount, completed, completed ? new Date() : null]
      );
      if (completed) {
        await awardUserExp(pool, userId, 'task_reward', task.rewardExp, `完成任务：${task.title}`);
      }
      continue;
    }

    if (progress.isCompleted) {
      continue;
    }

    const nextCount = Number(progress.progressCount || 0) + increment;
    const completed = nextCount >= task.targetCount;
    await pool.execute(
      `UPDATE user_task_progress
      SET progress_count = ?, is_completed = ?, completed_at = ?
      WHERE id = ?`,
      [nextCount, completed ? 1 : 0, completed ? new Date() : null, progress.id]
    );
    if (completed) {
      await awardUserExp(pool, userId, 'task_reward', task.rewardExp, `完成任务：${task.title}`);
    }
  }
}

function buildCommentTree(rows) {
  const byId = new Map();
  const roots = [];

  for (const row of rows) {
    byId.set(row.id, {
      ...row,
      replies: []
    });
  }

  for (const row of rows) {
    const current = byId.get(row.id);
    if (row.parentId && byId.has(row.parentId)) {
      byId.get(row.parentId).replies.push(current);
    } else {
      roots.push(current);
    }
  }

  return roots;
}

function toConversationPair(a, b) {
  return {
    lowId: Math.min(a, b),
    highId: Math.max(a, b)
  };
}

async function ensureConversation(pool, currentUserId, targetUserId, contextType = 'direct', contextId = null) {
  const pair = toConversationPair(currentUserId, targetUserId);
  let contextTitle = '';

  if (contextType === 'marketplace' && contextId) {
    const [itemRows] = await pool.execute(
      'SELECT id, title FROM marketplace_items WHERE id = ? LIMIT 1',
      [contextId]
    );
    const item = itemRows[0];
    if (!item) {
      throw new Error('MARKETPLACE_NOT_FOUND');
    }
    contextTitle = item.title;
  }

  const [rows] = await pool.execute(
    `SELECT id
    FROM message_conversations
    WHERE user_low_id = ? AND user_high_id = ? AND context_type = ? AND ((context_id IS NULL AND ? IS NULL) OR context_id = ?)
    LIMIT 1`,
    [pair.lowId, pair.highId, contextType, contextId || null, contextId || null]
  );
  if (rows[0]) {
    return rows[0].id;
  }

  const [result] = await pool.execute(
    `INSERT INTO message_conversations (
      user_low_id,
      user_high_id,
      context_type,
      context_id,
      context_title
    ) VALUES (?, ?, ?, ?, ?)`,
    [pair.lowId, pair.highId, contextType, contextId || null, contextTitle]
  );
  return result.insertId;
}

async function fetchConversations(pool, userId) {
  const [rows] = await pool.execute(
    `SELECT
      c.id,
      c.context_type AS contextType,
      c.context_id AS contextId,
      c.context_title AS contextTitle,
      c.updated_at AS updatedAt,
      u.id AS peerUserId,
      u.username AS peerUsername,
      u.level AS peerLevel,
      u.city AS peerCity,
      (
        SELECT me.content
        FROM message_entries me
        WHERE me.conversation_id = c.id
        ORDER BY me.created_at DESC, me.id DESC
        LIMIT 1
      ) AS lastMessage,
      (
        SELECT COUNT(*)
        FROM message_entries me
        WHERE me.conversation_id = c.id
          AND me.sender_id <> ?
          AND me.is_read = 0
      ) AS unreadCount,
      (
        SELECT MAX(me.created_at)
        FROM message_entries me
        WHERE me.conversation_id = c.id
          AND me.sender_id <> ?
          AND me.is_read = 0
      ) AS lastUnreadAt
    FROM message_conversations c
    INNER JOIN users u
      ON u.id = CASE WHEN c.user_low_id = ? THEN c.user_high_id ELSE c.user_low_id END
    WHERE c.user_low_id = ? OR c.user_high_id = ?
    ORDER BY c.updated_at DESC`,
    [userId, userId, userId, userId, userId]
  );

  return rows.map((item) => ({
    ...item,
    updatedLabel: toRelativeTime(item.updatedAt),
    unreadLabel: item.unreadCount ? `${item.unreadCount} 条未读` : '已读',
    lastUnreadLabel: item.lastUnreadAt ? toRelativeTime(item.lastUnreadAt) : ''
  }));
}

async function fetchConversationDetail(pool, conversationId, userId) {
  const [rows] = await pool.execute(
    `SELECT
      c.id,
      c.user_low_id AS userLowId,
      c.user_high_id AS userHighId,
      c.context_type AS contextType,
      c.context_id AS contextId,
      c.context_title AS contextTitle,
      c.updated_at AS updatedAt
    FROM message_conversations c
    WHERE c.id = ?
    LIMIT 1`,
    [conversationId]
  );
  const conversation = rows[0];
  if (!conversation || (conversation.userLowId !== userId && conversation.userHighId !== userId)) {
    return null;
  }

  const peerUserId = conversation.userLowId === userId ? conversation.userHighId : conversation.userLowId;
  const [peerRows, contextRows, unreadRows] = await Promise.all([
    pool.execute(
      'SELECT id, username, level, city FROM users WHERE id = ? LIMIT 1',
      [peerUserId]
    ).then(([items]) => items),
    pool.execute(
      `SELECT id, title, price, city, status, image_url AS imageUrl
      FROM marketplace_items
      WHERE id = ? AND ? = 'marketplace'
      LIMIT 1`,
      [conversation.contextId || 0, conversation.contextType]
    ).then(([items]) => items),
    pool.execute(
      `SELECT COUNT(*) AS unreadCount
      FROM message_entries
      WHERE conversation_id = ? AND sender_id <> ? AND is_read = 0`,
      [conversationId, userId]
    ).then(([items]) => items),
  ]);

  const justMarkedReadCount = Number(unreadRows[0]?.unreadCount || 0);

  if (justMarkedReadCount > 0) {
    await pool.execute(
      'UPDATE message_entries SET is_read = 1 WHERE conversation_id = ? AND sender_id <> ?',
      [conversationId, userId]
    );
  }

  const [messageRows] = await pool.execute(
    `SELECT
      id,
      sender_id AS senderId,
      content,
      is_read AS isRead,
      created_at AS createdAt
    FROM message_entries
    WHERE conversation_id = ?
    ORDER BY created_at ASC, id ASC
    LIMIT 100`,
    [conversationId]
  );

  return {
    conversation: {
      id: conversation.id,
      contextType: conversation.contextType,
      contextId: conversation.contextId,
      contextTitle: conversation.contextTitle,
      contextItem: contextRows[0]
        ? {
            ...contextRows[0],
            price: Number(contextRows[0].price)
          }
        : null,
      peer: peerRows[0] || null,
      updatedLabel: toRelativeTime(conversation.updatedAt)
    },
    readSync: {
      justMarkedReadCount,
      justMarkedReadLabel: justMarkedReadCount > 0 ? `已同步 ${justMarkedReadCount} 条未读消息` : '当前已是最新状态'
    },
    messages: messageRows.map((item) => ({
      ...item,
      publishedLabel: toRelativeTime(item.createdAt)
    }))
  };
}

async function syncCommentReactionCounts(pool, commentId) {
  await pool.execute(
    `UPDATE post_comments
    SET likes_count = (
      SELECT COUNT(*)
      FROM comment_reactions
      WHERE comment_id = ? AND reaction_type = 'like'
    )
    WHERE id = ?`,
    [commentId, commentId]
  );
}

async function fetchCommentById(pool, commentId) {
  const [rows] = await pool.execute(
    `SELECT
      c.id,
      c.post_id AS postId,
      c.user_id AS userId,
      c.parent_id AS parentId,
      c.content,
      c.likes_count AS likesCount,
      c.deleted_at AS deletedAt
    FROM post_comments c
    WHERE c.id = ?
    LIMIT 1`,
    [commentId]
  );
  return rows[0] || null;
}

async function fetchPostReactionState(pool, postId, userId) {
  if (!userId) {
    return { isLiked: false, isFavorited: false };
  }

  const [rows] = await pool.execute(
    `SELECT reaction_type AS reactionType
    FROM post_reactions
    WHERE post_id = ? AND user_id = ?`,
    [postId, userId]
  );

  const types = new Set(rows.map((item) => item.reactionType));
  return {
    isLiked: types.has('like'),
    isFavorited: types.has('favorite')
  };
}

async function syncPostReactionCounts(pool, postId) {
  await pool.execute(
    `UPDATE posts
    SET
      likes_count = (
        SELECT COUNT(*)
        FROM post_reactions
        WHERE post_id = ? AND reaction_type = 'like'
      ),
      favorites_count = (
        SELECT COUNT(*)
        FROM post_reactions
        WHERE post_id = ? AND reaction_type = 'favorite'
      )
    WHERE id = ?`,
    [postId, postId, postId]
  );
}

async function fetchPostComments(pool, postId, authUser) {
  const [rows] = await pool.execute(
    `SELECT
      c.id,
      c.parent_id AS parentId,
      c.content,
      c.likes_count AS likesCount,
      c.deleted_at AS deletedAt,
      c.created_at AS createdAt,
      u.id AS userId,
      u.username,
      u.level,
      u.city,
      pu.id AS replyToUserId,
      pu.username AS replyToUsername
    FROM post_comments c
    INNER JOIN users u ON u.id = c.user_id
    LEFT JOIN post_comments pc ON pc.id = c.parent_id
    LEFT JOIN users pu ON pu.id = pc.user_id
    WHERE c.post_id = ?
    ORDER BY c.created_at ASC
    LIMIT 50`,
    [postId]
  );

  let likedSet = new Set();
  let reportedSet = new Set();
  if (authUser?.id) {
    const [reactionRows, reportRows] = await Promise.all([
      pool.execute(
        `SELECT comment_id AS commentId
        FROM comment_reactions
        WHERE user_id = ? AND reaction_type = 'like'`,
        [authUser.id]
      ).then(([items]) => items),
      pool.execute(
        `SELECT comment_id AS commentId
        FROM comment_reports
        WHERE user_id = ?`,
        [authUser.id]
      ).then(([items]) => items)
    ]);
    likedSet = new Set(reactionRows.map((item) => item.commentId));
    reportedSet = new Set(reportRows.map((item) => item.commentId));
  }

  return buildCommentTree(rows.map((item) => ({
    ...item,
    content: item.deletedAt ? '该评论已删除' : item.content,
    username: item.deletedAt ? '已删除用户' : item.username,
    level: item.deletedAt ? 0 : item.level,
    city: item.deletedAt ? '' : item.city,
    isDeleted: Boolean(item.deletedAt),
    isLiked: likedSet.has(item.id),
    isReported: reportedSet.has(item.id),
    canDelete: Boolean(authUser?.id) && (authUser.id === item.userId || ['admin', 'super_admin'].includes(authUser.role)),
    publishedLabel: toRelativeTime(item.createdAt)
  })));
}

async function fetchPostCommentPreviews(pool, postIds) {
  if (!postIds.length) {
    return new Map();
  }

  const placeholders = postIds.map(() => '?').join(', ');
  const [rows] = await pool.execute(
    `SELECT
      c.id,
      c.post_id AS postId,
      c.content,
      c.created_at AS createdAt,
      u.username
    FROM post_comments c
    INNER JOIN users u ON u.id = c.user_id
    WHERE c.post_id IN (${placeholders})
    ORDER BY c.created_at DESC`,
    postIds
  );

  const grouped = new Map();
  for (const row of rows) {
    const bucket = grouped.get(row.postId) || [];
    if (bucket.length < 2) {
      bucket.push({
        id: row.id,
        username: row.username,
        content: row.content,
        publishedLabel: toRelativeTime(row.createdAt)
      });
      grouped.set(row.postId, bucket);
    }
  }
  return grouped;
}

function formatRecommendationPosts(rows) {
  return rows.map((item) => ({
    ...item,
    publishedLabel: toRelativeTime(item.createdAt)
  }));
}

async function fetchPostRecommendations(pool, post) {
  const collectedIds = new Set([post.id]);

  const [authorRows] = await pool.execute(
    `SELECT
      id,
      title,
      summary,
      category,
      city,
      created_at AS createdAt
    FROM posts
    WHERE user_id = ? AND id <> ? AND moderation_status = 'visible'
    ORDER BY created_at DESC
    LIMIT 3`,
    [post.authorId, post.id]
  );
  const authorPosts = formatRecommendationPosts(authorRows);
  for (const item of authorPosts) {
    collectedIds.add(item.id);
  }

  let tagPosts = [];
  const tagExcludes = Array.from(collectedIds);
  const tagPlaceholders = tagExcludes.map(() => '?').join(', ');
  const [tagRows] = await pool.execute(
    `SELECT
      id,
      title,
      summary,
      category,
      city,
      created_at AS createdAt
    FROM posts
    WHERE category = ?
      AND moderation_status = 'visible'
      AND id NOT IN (${tagPlaceholders})
    ORDER BY likes_count DESC, comments_count DESC, created_at DESC
    LIMIT 4`,
    [post.category, ...tagExcludes]
  );
  tagPosts = formatRecommendationPosts(tagRows);
  for (const item of tagPosts) {
    collectedIds.add(item.id);
  }

  const cityExcludes = Array.from(collectedIds);
  const cityPlaceholders = cityExcludes.map(() => '?').join(', ');
  const [cityRows] = await pool.execute(
    `SELECT
      id,
      title,
      summary,
      category,
      city,
      created_at AS createdAt
    FROM posts
    WHERE city = ?
      AND moderation_status = 'visible'
      AND id NOT IN (${cityPlaceholders})
    ORDER BY created_at DESC
    LIMIT 4`,
    [post.city, ...cityExcludes]
  );
  const cityPosts = formatRecommendationPosts(cityRows);

  return {
    authorPosts,
    tagPosts,
    cityPosts
  };
}

async function fetchCommunityOverview(pool) {
  const [counts] = await pool.execute(
    `SELECT
      (SELECT COUNT(*) FROM posts WHERE moderation_status = 'visible') AS postCount,
      (SELECT COUNT(*) FROM users) AS userCount,
      (SELECT COUNT(*) FROM activities WHERE status = 'published') AS activityCount,
      (SELECT COUNT(*) FROM marketplace_items WHERE status = 'active' AND moderation_status = 'visible') AS marketplaceCount`
  );
  return counts[0];
}

async function fetchPosts(pool, userCity, userId) {
  let preferredCategories = new Set();
  if (userId) {
    const [interestRows] = await pool.execute(
      `SELECT p.category
      FROM post_reactions r
      INNER JOIN posts p ON p.id = r.post_id
      WHERE r.user_id = ?
      ORDER BY r.created_at DESC
      LIMIT 6`,
      [userId]
    );
    preferredCategories = new Set(interestRows.map((item) => item.category));
  }

  const [rows] = await pool.execute(
    `SELECT
      p.id,
      p.title,
      p.summary,
      p.category,
      p.content_type AS contentType,
      p.city,
      p.is_official AS isOfficial,
      p.is_pinned AS isPinned,
      p.views,
      p.comments_count AS commentsCount,
      p.likes_count AS likesCount,
      p.favorites_count AS favoritesCount,
      p.created_at AS createdAt,
      u.id AS authorId,
      u.username,
      u.level,
      u.city AS authorCity,
      u.avatar_url AS avatarUrl
    FROM posts p
    INNER JOIN users u ON u.id = p.user_id
    WHERE p.moderation_status = 'visible'
    ORDER BY p.is_pinned DESC, p.created_at DESC
    LIMIT 24`
  );

  let likedSet = new Set();
  let favoritedSet = new Set();
  if (userId) {
    const [reactionRows] = await pool.execute(
      `SELECT post_id AS postId, reaction_type AS reactionType
      FROM post_reactions
      WHERE user_id = ?`,
      [userId]
    );
    likedSet = new Set(reactionRows.filter((item) => item.reactionType === 'like').map((item) => item.postId));
    favoritedSet = new Set(reactionRows.filter((item) => item.reactionType === 'favorite').map((item) => item.postId));
  }

  const previewCommentsMap = await fetchPostCommentPreviews(pool, rows.map((item) => item.id));

  const enriched = rows.map((item) => ({
    ...item,
    heat: computeHeat(item),
    recommendScore:
      computeHeat(item)
      + (item.city === userCity ? 36 : 0)
      + (preferredCategories.has(item.category) ? 28 : 0)
      + (item.isPinned ? 20 : 0),
    publishedLabel: toRelativeTime(item.createdAt),
    tags: [`#${item.category}`, `#${item.city}`],
    isLiked: likedSet.has(item.id),
    isFavorited: favoritedSet.has(item.id),
    previewComments: previewCommentsMap.get(item.id) || []
  }));

  return {
    featured: [...enriched]
      .sort((a, b) => b.recommendScore - a.recommendScore || new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 8),
    hot: enriched
      .filter((item) => !item.isPinned)
      .sort((a, b) => b.heat - a.heat)
      .slice(0, 8)
      .map((item, index) => ({ ...item, rank: index + 1 })),
    cityPosts: enriched.filter((item) => item.city === userCity).slice(0, 6),
    rising: enriched
      .filter((item) => !item.isOfficial)
      .sort((a, b) => (b.commentsCount + b.likesCount) - (a.commentsCount + a.likesCount))
      .slice(0, 5)
  };
}

async function fetchLevels(pool, authUser) {
  const [rows] = await pool.execute(
    `SELECT level, COUNT(*) AS userCount, AVG(exp) AS avgExp
    FROM users
    GROUP BY level
    ORDER BY level ASC`
  );
  const stats = new Map(rows.map((row) => [row.level, row]));

  const levels = [];
  for (let level = 1; level <= 10; level += 1) {
    const row = stats.get(level) || { userCount: 0, avgExp: 0 };
    levels.push({
      level,
      title: levelTitle(level),
      requiredExp: level * 120,
      benefits: levelBenefits(level),
      userCount: row.userCount,
      avgExp: Math.round(Number(row.avgExp || 0))
    });
  }

  const [leaders] = await pool.execute(
    `SELECT username, level, exp, city
    FROM users
    ORDER BY level DESC, exp DESC, id ASC
    LIMIT 8`
  );

  let myProgress = null;
  if (authUser?.id) {
    const [logs, records, tasks] = await Promise.all([
      pool.execute(
        `SELECT action_type AS actionType, delta_exp AS deltaExp, description, created_at AS createdAt
        FROM exp_logs
        WHERE user_id = ?
        ORDER BY created_at DESC
        LIMIT 8`,
        [authUser.id]
      ).then(([items]) => items),
      pool.execute(
        `SELECT previous_level AS previousLevel, next_level AS nextLevel, created_at AS createdAt
        FROM level_records
        WHERE user_id = ?
        ORDER BY created_at DESC
        LIMIT 6`,
        [authUser.id]
      ).then(([items]) => items),
      pool.execute(
        `SELECT
          t.id,
          t.title,
          t.task_type AS taskType,
          t.target_count AS targetCount,
          t.reward_exp AS rewardExp,
          t.description,
          COALESCE(p.progress_count, 0) AS progressCount,
          COALESCE(p.is_completed, 0) AS isCompleted
        FROM level_tasks t
        LEFT JOIN user_task_progress p
          ON p.task_id = t.id AND p.user_id = ?
        WHERE t.is_active = 1 AND t.min_level <= ?
        ORDER BY t.min_level ASC, t.id ASC
        LIMIT 8`,
        [authUser.id, authUser.level || 1]
      ).then(([items]) => items)
    ]);

    myProgress = {
      badge: levelBadge(authUser.level || 1),
      logs: logs.map((item) => ({ ...item, publishedLabel: toRelativeTime(item.createdAt) })),
      records: records.map((item) => ({ ...item, publishedLabel: toRelativeTime(item.createdAt) })),
      tasks: tasks.map((item) => ({
        ...item,
        percent: Math.min(100, Math.round((Number(item.progressCount || 0) / Math.max(1, Number(item.targetCount || 1))) * 100))
      }))
    };
  }

  return { levels, leaders, myProgress };
}

async function fetchNews(pool) {
  const [rows] = await pool.execute(
    `SELECT
      id,
      title,
      summary,
      source,
      category,
      views,
      comments_count AS commentsCount,
      likes_count AS likesCount,
      shares_count AS sharesCount,
      moderation_status AS moderationStatus,
      published_at AS publishedAt
    FROM news_items
    WHERE moderation_status = 'visible'
    ORDER BY published_at DESC
    LIMIT 6`
  );
  return rows.map((item) => ({
    ...item,
    publishedLabel: toRelativeTime(item.publishedAt)
  }));
}

async function fetchNewsReactionState(pool, newsId, userId) {
  if (!userId) {
    return { isLiked: false };
  }

  const [rows] = await pool.execute(
    `SELECT reaction_type AS reactionType
    FROM news_reactions
    WHERE news_id = ? AND user_id = ?`,
    [newsId, userId]
  );

  return {
    isLiked: rows.some((item) => item.reactionType === 'like')
  };
}

async function syncNewsReactionCounts(pool, newsId) {
  await pool.execute(
    `UPDATE news_items
    SET likes_count = (
      SELECT COUNT(*)
      FROM news_reactions
      WHERE news_id = ? AND reaction_type = 'like'
    )
    WHERE id = ?`,
    [newsId, newsId]
  );
}

async function syncNewsCommentCounts(pool, newsId) {
  await pool.execute(
    `UPDATE news_items
    SET comments_count = (
      SELECT COUNT(*)
      FROM news_comments
      WHERE news_id = ?
    )
    WHERE id = ?`,
    [newsId, newsId]
  );
}

async function fetchMatches(pool) {
  const [rows] = await pool.execute(
    `SELECT
      id,
      title,
      match_type AS matchType,
      location,
      start_time AS startTime,
      status,
      highlight,
      participants,
      current_score AS currentScore
    FROM matches
    ORDER BY start_time ASC
    LIMIT 6`
  );
  return rows.map((item) => ({
    ...item,
    publishedLabel: toRelativeTime(item.startTime)
  }));
}

async function fetchCities(pool, userCity) {
  const [cities] = await pool.execute(
    `SELECT id, name, tier, post_count AS postCount, activity_count AS activityCount, marketplace_count AS marketplaceCount
    FROM cities
    ORDER BY post_count DESC, activity_count DESC`
  );
  const [venues] = await pool.execute(
    `SELECT
      v.id,
      c.name AS city,
      v.name,
      v.address,
      v.business_hours AS businessHours,
      v.price_range AS priceRange,
      v.evaluation
    FROM venues v
    INNER JOIN cities c ON c.id = v.city_id
    ORDER BY v.id ASC`
  );
  return {
    selectedCity: userCity,
    cities,
    venues,
    hotCities: cities.slice(0, 4)
  };
}

async function fetchVenueDetail(pool, venueId, userId) {
  const [rows] = await pool.execute(
    `SELECT
      v.id,
      c.name AS city,
      v.name,
      v.address,
      v.business_hours AS businessHours,
      v.price_range AS priceRange,
      v.evaluation
    FROM venues v
    INNER JOIN cities c ON c.id = v.city_id
    WHERE v.id = ?
    LIMIT 1`,
    [venueId]
  );
  const venue = rows[0];
  if (!venue) {
    return null;
  }

  const [reviewRows, favoriteRows, favoriteCountRows, relatedRows] = await Promise.all([
    pool.execute(
      `SELECT
        r.id,
        r.rating,
        r.content,
        r.created_at AS createdAt,
        u.id AS userId,
        u.username,
        u.level,
        u.city
      FROM venue_reviews r
      INNER JOIN users u ON u.id = r.user_id
      WHERE r.venue_id = ?
      ORDER BY r.created_at DESC
      LIMIT 20`,
      [venueId]
    ).then(([items]) => items),
    userId
      ? pool.execute('SELECT id FROM venue_favorites WHERE venue_id = ? AND user_id = ? LIMIT 1', [venueId, userId]).then(([items]) => items)
      : Promise.resolve([]),
    pool.execute('SELECT COUNT(*) AS favoriteCount FROM venue_favorites WHERE venue_id = ?', [venueId]).then(([items]) => items),
    pool.execute(
      `SELECT
        v.id,
        c.name AS city,
        v.name,
        v.address,
        v.price_range AS priceRange
      FROM venues v
      INNER JOIN cities c ON c.id = v.city_id
      WHERE c.name = ? AND v.id <> ?
      ORDER BY v.id ASC
      LIMIT 4`,
      [venue.city, venueId]
    ).then(([items]) => items)
  ]);

  const averageRating = reviewRows.length
    ? Math.round((reviewRows.reduce((sum, item) => sum + Number(item.rating || 0), 0) / reviewRows.length) * 10) / 10
    : 0;

  return {
    venue: {
      ...venue,
      reviewCount: reviewRows.length,
      favoriteCount: Number(favoriteCountRows[0]?.favoriteCount || 0),
      averageRating,
      isFavorited: Boolean(favoriteRows[0])
    },
    reviews: reviewRows.map((item) => ({ ...item, publishedLabel: toRelativeTime(item.createdAt) })),
    relatedVenues: relatedRows
  };
}

async function fetchActivities(pool, userId) {
  const [rows] = await pool.execute(
    `SELECT
      a.id,
      a.title,
      a.type,
      a.city,
      a.venue_name AS venueName,
      a.address,
      a.start_time AS startTime,
      a.signup_deadline AS signupDeadline,
      a.capacity,
      a.signed_count AS signedCount,
      a.level_limit AS levelLimit,
      a.summary,
      a.status,
      a.review_status AS reviewStatus,
      u.username AS organizerName,
      u.level AS organizerLevel
    FROM activities a
    INNER JOIN users u ON u.id = a.user_id
    WHERE a.status = 'published' AND a.review_status = 'approved'
    ORDER BY a.start_time ASC
    LIMIT 12`
  );

  let registrationSet = new Set();
  if (userId) {
    const [registrationRows] = await pool.execute(
      'SELECT activity_id AS activityId FROM activity_registrations WHERE user_id = ?',
      [userId]
    );
    registrationSet = new Set(registrationRows.map((item) => item.activityId));
  }

  return rows.map((item) => ({
    ...item,
    publishedLabel: toRelativeTime(item.startTime),
    isJoined: registrationSet.has(item.id)
  }));
}

async function fetchActivityComments(pool, activityId) {
  const [rows] = await pool.execute(
    `SELECT
      c.id,
      c.content,
      c.created_at AS createdAt,
      u.id AS userId,
      u.username,
      u.level,
      u.city
    FROM activity_comments c
    INNER JOIN users u ON u.id = c.user_id
    WHERE c.activity_id = ?
    ORDER BY c.created_at ASC
    LIMIT 80`,
    [activityId]
  );

  return rows.map((item) => ({
    ...item,
    publishedLabel: toRelativeTime(item.createdAt)
  }));
}

async function fetchActivityFeedback(pool, activityId) {
  const [rows] = await pool.execute(
    `SELECT
      f.id,
      f.rating,
      f.content,
      f.created_at AS createdAt,
      u.id AS userId,
      u.username,
      u.level,
      u.city
    FROM activity_feedback f
    INNER JOIN users u ON u.id = f.user_id
    WHERE f.activity_id = ?
    ORDER BY f.created_at DESC
    LIMIT 50`,
    [activityId]
  );

  return rows.map((item) => ({
    ...item,
    publishedLabel: toRelativeTime(item.createdAt)
  }));
}

async function fetchActiveActivityPenalty(pool, userId) {
  if (!userId) {
    return null;
  }

  const [rows] = await pool.execute(
    `SELECT id, reason, blocked_until AS blockedUntil
    FROM activity_penalties
    WHERE user_id = ? AND blocked_until > NOW()
    ORDER BY blocked_until DESC
    LIMIT 1`,
    [userId]
  );

  return rows[0] || null;
}

function buildActivityNotes(activity) {
  return [
    `请至少提前 15 分钟到达 ${activity.venueName}，避免影响开场节奏。`,
    `活动当前等级要求为 Lv.${activity.levelLimit}+，建议按真实水平参与报名。`,
    '如需取消报名，请在报名截止前完成；频繁取消会触发短期报名限制。',
    '活动开始前 1 天会通过站内消息提醒已报名用户留意时间与地点。'
  ];
}

async function fetchMarketplace(pool) {
  const [rows] = await pool.execute(
    `SELECT
      m.id,
      m.type,
      m.category,
      m.title,
      m.condition_level AS conditionLevel,
      m.price,
      m.city,
      m.summary,
      m.status,
      m.created_at AS createdAt,
      u.username,
      u.level
    FROM marketplace_items m
    INNER JOIN users u ON u.id = m.user_id
    WHERE m.status = 'active' AND m.moderation_status = 'visible'
    ORDER BY m.created_at DESC
    LIMIT 12`
  );
  return rows.map((item) => ({
    ...item,
    ...mapMarketplaceImages(item.imageUrl),
    publishedLabel: toRelativeTime(item.createdAt)
  }));
}

async function fetchMarketplaceRecommendations(pool, item) {
  const [sameSellerRows, sameCategoryRows] = await Promise.all([
    pool.execute(
      `SELECT
        id,
        title,
        type,
        category,
        city,
        price,
        created_at AS createdAt
      FROM marketplace_items
      WHERE user_id = ? AND id <> ? AND status = 'active' AND moderation_status = 'visible'
      ORDER BY created_at DESC
      LIMIT 4`,
      [item.sellerId, item.id]
    ).then(([rows]) => rows),
    pool.execute(
      `SELECT
        id,
        title,
        type,
        category,
        city,
        price,
        created_at AS createdAt
      FROM marketplace_items
      WHERE category = ? AND id <> ? AND status = 'active' AND moderation_status = 'visible'
      ORDER BY created_at DESC
      LIMIT 4`,
      [item.category, item.id]
    ).then(([rows]) => rows)
  ]);

  const mapItem = (row) => ({ ...row, publishedLabel: toRelativeTime(row.createdAt) });
  return {
    sameSeller: sameSellerRows.map(mapItem),
    sameCategory: sameCategoryRows.map(mapItem)
  };
}

async function fetchMarketplaceComments(pool, itemId) {
  const [rows] = await pool.execute(
    `SELECT
      c.id,
      c.content,
      c.created_at AS createdAt,
      u.id AS userId,
      u.username,
      u.level,
      u.city
    FROM marketplace_comments c
    INNER JOIN users u ON u.id = c.user_id
    WHERE c.item_id = ?
    ORDER BY c.created_at ASC, c.id ASC
    LIMIT 100`,
    [itemId]
  );

  return rows.map((item) => ({
    ...item,
    publishedLabel: toRelativeTime(item.createdAt)
  }));
}

async function fetchProfile(pool, authUser) {
  if (!authUser) {
    return null;
  }

  const [contentRows] = await pool.execute(
    `SELECT
      (SELECT COUNT(*) FROM posts WHERE user_id = ?) AS postCount,
      (SELECT COUNT(*) FROM activities WHERE user_id = ?) AS activityCount,
      (SELECT COUNT(*) FROM marketplace_items WHERE user_id = ? AND moderation_status = 'visible') AS marketplaceCount,
      (SELECT COUNT(*) FROM user_follows WHERE follower_id = ?) AS followingCount,
      (SELECT COUNT(*) FROM user_follows WHERE following_id = ?) AS followerCount,
      (SELECT COUNT(*) FROM notifications WHERE user_id = ? AND is_read = 0) AS unreadCount`,
    [authUser.id, authUser.id, authUser.id, authUser.id, authUser.id, authUser.id]
  );
  const [latestPosts] = await pool.execute(
    `SELECT id, title, created_at AS createdAt, likes_count AS likesCount, comments_count AS commentsCount
    FROM posts
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT 5`,
    [authUser.id]
  );
  const [notifications] = await pool.execute(
    `SELECT id, type, title, body, target_type AS targetType, target_id AS targetId, action_url AS actionUrl, is_read AS isRead, created_at AS createdAt
    FROM notifications
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT 6`,
    [authUser.id]
  );

  const progressMax = Math.max(authUser.level * 120, 120);
  return {
    user: authUser,
    stats: contentRows[0],
    latestPosts: latestPosts.map((item) => ({ ...item, publishedLabel: toRelativeTime(item.createdAt) })),
    notifications: notifications.map((item) => ({ ...item, publishedLabel: toRelativeTime(item.createdAt) })),
    progress: {
      current: authUser.exp,
      nextLevelExp: progressMax,
      percent: Math.min(100, Math.round((authUser.exp / progressMax) * 100))
    },
    badge: levelBadge(authUser.level || 1)
  };
}

async function fetchMyDashboard(pool, authUser) {
  if (!authUser) {
    return null;
  }

  const [statsRows, myPosts, myDrafts, myActivities, myMarketplace, likedPosts, favoritedPosts, myComments, notifications, followingRows, followerRows] = await Promise.all([
    pool.execute(
      `SELECT
        (SELECT COUNT(*) FROM posts WHERE user_id = ?) AS postCount,
        (SELECT COUNT(*) FROM post_drafts WHERE user_id = ?) AS draftCount,
        (SELECT COUNT(*) FROM activities WHERE user_id = ?) AS activityCount,
        (SELECT COUNT(*) FROM marketplace_items WHERE user_id = ?) AS marketplaceCount,
        (SELECT COUNT(*) FROM user_follows WHERE follower_id = ?) AS followingCount,
        (SELECT COUNT(*) FROM user_follows WHERE following_id = ?) AS followerCount,
        (SELECT COUNT(*) FROM post_comments WHERE user_id = ? AND deleted_at IS NULL) AS commentCount,
        (SELECT COUNT(*) FROM notifications WHERE user_id = ? AND is_read = 0) AS unreadCount`,
      [authUser.id, authUser.id, authUser.id, authUser.id, authUser.id, authUser.id, authUser.id, authUser.id]
    ).then(([rows]) => rows[0]),
    pool.execute(
      `SELECT id, title, summary, category, created_at AS createdAt, likes_count AS likesCount, comments_count AS commentsCount
      FROM posts
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT 8`,
      [authUser.id]
    ).then(([rows]) => rows),
    pool.execute(
      `SELECT
        id,
        title,
        summary,
        category,
        content_type AS contentType,
        city,
        updated_at AS updatedAt
      FROM post_drafts
      WHERE user_id = ?
      ORDER BY updated_at DESC
      LIMIT 6`,
      [authUser.id]
    ).then(([rows]) => rows),
    pool.execute(
      `SELECT id, title, type, city, venue_name AS venueName, signed_count AS signedCount, capacity, status, created_at AS createdAt
      FROM activities
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT 6`,
      [authUser.id]
    ).then(([rows]) => rows),
    pool.execute(
      `SELECT id, title, type, city, price, summary, status, created_at AS createdAt
      FROM marketplace_items
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT 6`,
      [authUser.id]
    ).then(([rows]) => rows),
    pool.execute(
      `SELECT
        p.id,
        p.title,
        p.summary,
        p.category,
        p.created_at AS createdAt,
        p.likes_count AS likesCount,
        p.comments_count AS commentsCount
      FROM post_reactions r
      INNER JOIN posts p ON p.id = r.post_id
      WHERE r.user_id = ? AND r.reaction_type = 'like'
      ORDER BY r.created_at DESC
      LIMIT 6`,
      [authUser.id]
    ).then(([rows]) => rows),
    pool.execute(
      `SELECT
        p.id,
        p.title,
        p.summary,
        p.category,
        p.created_at AS createdAt,
        p.likes_count AS likesCount,
        p.comments_count AS commentsCount
      FROM post_reactions r
      INNER JOIN posts p ON p.id = r.post_id
      WHERE r.user_id = ? AND r.reaction_type = 'favorite'
      ORDER BY r.created_at DESC
      LIMIT 6`,
      [authUser.id]
    ).then(([rows]) => rows),
    pool.execute(
      `SELECT
        c.id,
        c.post_id AS postId,
        c.content,
        c.created_at AS createdAt,
        p.title AS postTitle
      FROM post_comments c
      INNER JOIN posts p ON p.id = c.post_id
      WHERE c.user_id = ?
      ORDER BY c.created_at DESC
      LIMIT 8`,
      [authUser.id]
    ).then(([rows]) => rows),
    pool.execute(
      `SELECT id, type, title, body, target_type AS targetType, target_id AS targetId, action_url AS actionUrl, is_read AS isRead, created_at AS createdAt
      FROM notifications
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT 24`,
      [authUser.id]
    ).then(([rows]) => rows),
    pool.execute(
      `SELECT u.id, u.username, u.level, u.city
      FROM user_follows f
      INNER JOIN users u ON u.id = f.following_id
      WHERE f.follower_id = ?
      ORDER BY f.created_at DESC
      LIMIT 8`,
      [authUser.id]
    ).then(([rows]) => rows),
    pool.execute(
      `SELECT u.id, u.username, u.level, u.city
      FROM user_follows f
      INNER JOIN users u ON u.id = f.follower_id
      WHERE f.following_id = ?
      ORDER BY f.created_at DESC
      LIMIT 8`,
      [authUser.id]
    ).then(([rows]) => rows)
  ]);

  const mapPost = (item) => ({ ...item, publishedLabel: toRelativeTime(item.createdAt) });

  return {
    user: authUser,
    stats: statsRows,
    myContent: {
      posts: myPosts.map(mapPost),
      drafts: myDrafts.map((item) => ({ ...item, publishedLabel: toRelativeTime(item.updatedAt) })),
      activities: myActivities.map((item) => ({ ...item, publishedLabel: toRelativeTime(item.createdAt) })),
      marketplace: myMarketplace.map((item) => ({ ...item, publishedLabel: toRelativeTime(item.createdAt) }))
    },
    interactions: {
      likedPosts: likedPosts.map(mapPost),
      favoritedPosts: favoritedPosts.map(mapPost),
      comments: myComments.map((item) => ({ ...item, publishedLabel: toRelativeTime(item.createdAt) }))
    },
    notifications: notifications.map((item) => ({ ...item, publishedLabel: toRelativeTime(item.createdAt) })),
    relations: {
      following: followingRows,
      followers: followerRows
    }
  };
}

async function fetchAuthorProfile(pool, authorId) {
  const [authorRows] = await pool.execute(
    `SELECT
      id,
      username,
      email,
      role,
      city,
      bio,
      level,
      exp,
      avatar_url AS avatarUrl,
      banner_url AS bannerUrl
    FROM users
    WHERE id = ?
    LIMIT 1`,
    [authorId]
  );
  const author = authorRows[0];
  if (!author) {
    return null;
  }

  const [statsRows] = await pool.execute(
    `SELECT
      (SELECT COUNT(*) FROM posts WHERE user_id = ?) AS postCount,
      (SELECT COUNT(*) FROM activities WHERE user_id = ?) AS activityCount,
      (SELECT COUNT(*) FROM marketplace_items WHERE user_id = ?) AS marketplaceCount,
      (SELECT COUNT(*) FROM user_follows WHERE follower_id = ?) AS followingCount,
      (SELECT COUNT(*) FROM user_follows WHERE following_id = ?) AS followerCount`,
    [authorId, authorId, authorId, authorId, authorId]
  );
  const [latestPostRows] = await pool.execute(
    `SELECT id, title, summary, category, created_at AS createdAt, likes_count AS likesCount, comments_count AS commentsCount
    FROM posts
    WHERE user_id = ? AND moderation_status = 'visible'
    ORDER BY created_at DESC
    LIMIT 10`,
    [authorId]
  );
  const [activityRows] = await pool.execute(
    `SELECT
      id,
      title,
      type,
      city,
      venue_name AS venueName,
      start_time AS startTime,
      signed_count AS signedCount,
      capacity,
      status,
      review_status AS reviewStatus
    FROM activities
    WHERE user_id = ?
    ORDER BY start_time DESC
    LIMIT 8`,
    [authorId]
  );
  const [marketplaceRows] = await pool.execute(
    `SELECT
      id,
      type,
      category,
      title,
      condition_level AS conditionLevel,
      price,
      city,
      summary,
      status,
      created_at AS createdAt
    FROM marketplace_items
    WHERE user_id = ? AND moderation_status = 'visible'
    ORDER BY created_at DESC
    LIMIT 8`,
    [authorId]
  );

  return {
    author,
    stats: statsRows[0],
    latestPosts: latestPostRows.map((item) => ({
      ...item,
      publishedLabel: toRelativeTime(item.createdAt)
    })),
    activities: activityRows.map((item) => ({
      ...item,
      publishedLabel: toRelativeTime(item.startTime)
    })),
    marketplace: marketplaceRows.map((item) => ({
      ...item,
      publishedLabel: toRelativeTime(item.createdAt)
    }))
  };
}

async function fetchFollowState(pool, viewerId, authorId) {
  if (!viewerId || viewerId === authorId) {
    return false;
  }

  const [rows] = await pool.execute(
    'SELECT id FROM user_follows WHERE follower_id = ? AND following_id = ? LIMIT 1',
    [viewerId, authorId]
  );
  return Boolean(rows[0]);
}

async function markNotificationRead(pool, notificationId, userId) {
  const [rows] = await pool.execute(
    'SELECT id FROM notifications WHERE id = ? AND user_id = ? LIMIT 1',
    [notificationId, userId]
  );
  if (!rows[0]) {
    return false;
  }

  await pool.execute('UPDATE notifications SET is_read = 1 WHERE id = ?', [notificationId]);
  return true;
}

async function clearReadNotifications(pool, userId) {
  const [result] = await pool.execute(
    'DELETE FROM notifications WHERE user_id = ? AND is_read = 1',
    [userId]
  );
  return result.affectedRows || 0;
}

async function requireModerator(req, res) {
  const user = await requireAuth(req, res);
  if (!user) {
    return null;
  }
  if (!['admin', 'super_admin'].includes(user.role)) {
    res.status(403).json({ message: '仅管理员可执行该操作' });
    return null;
  }
  return user;
}

function isModerator(user) {
  return Boolean(user && ['admin', 'super_admin'].includes(user.role));
}

async function logModerationAction(pool, payload) {
  await pool.execute(
    `INSERT INTO moderation_logs (
      actor_user_id,
      target_type,
      target_id,
      action,
      summary,
      reason
    ) VALUES (?, ?, ?, ?, ?, ?)`,
    [
      payload.actorUserId || null,
      payload.targetType,
      payload.targetId,
      payload.action,
      payload.summary,
      payload.reason || ''
    ]
  );
}

function buildDailySeries(days, sources) {
  const now = new Date();
  const labels = [];
  const maps = Object.fromEntries(Object.keys(sources).map((key) => [key, new Map()]));
  Object.entries(sources).forEach(([key, rows]) => {
    rows.forEach((item) => {
      maps[key].set(String(item.day), Number(item.count) || 0);
    });
  });

  const series = [];
  for (let index = days - 1; index >= 0; index -= 1) {
    const date = new Date(now);
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - index);
    const day = date.toISOString().slice(0, 10);
    labels.push(day);
    series.push({
      day,
      label: day.slice(5),
      ...Object.fromEntries(Object.keys(sources).map((key) => [key, maps[key].get(day) || 0]))
    });
  }
  return series;
}

async function fetchAuthorProfileWithViewer(pool, authorId, viewerId) {
  const profile = await fetchAuthorProfile(pool, authorId);
  if (!profile) {
    return null;
  }

  return {
    ...profile,
    relation: {
      isFollowing: await fetchFollowState(pool, viewerId, authorId)
    }
  };
}

async function fetchPostDraftById(pool, draftId, userId) {
  const [rows] = await pool.execute(
    `SELECT
      id,
      user_id AS userId,
      title,
      category,
      content_type AS contentType,
      city,
      summary,
      content,
      updated_at AS updatedAt
    FROM post_drafts
    WHERE id = ? AND user_id = ?
    LIMIT 1`,
    [draftId, userId]
  );
  return rows[0] || null;
}

router.get('/bootstrap', async (req, res) => {
  const pool = getPool();
  const authUser = await getAuthUser(req);
  const userCity = authUser?.city || '上海';

  const [overview, posts, levels, news, matches, cities, activities, marketplace, profile] = await Promise.all([
    fetchCommunityOverview(pool),
    fetchPosts(pool, userCity, authUser?.id || 0),
    fetchLevels(pool, authUser),
    fetchNews(pool),
    fetchMatches(pool),
    fetchCities(pool, userCity),
    fetchActivities(pool, authUser?.id || 0),
    fetchMarketplace(pool),
    fetchProfile(pool, authUser)
  ]);

  return res.json({
    hero: {
      title: '羽毛球爱好者一站式互动社区',
      subtitle: '围绕技术、装备、比赛、同城活动与闲置交易建立线上线下闭环。',
      overview
    },
    tabs: ['首页', '最热', '等级', '新闻', '比赛', '城市', '活动', '交易', '个人中心'],
    posts,
    levels,
    news,
    matches,
    cities,
    activities,
    marketplace,
    profile
  });
});

router.get('/news/:id', async (req, res) => {
  const newsId = Number(req.params.id);
  if (!Number.isInteger(newsId) || newsId <= 0) {
    return res.status(400).json({ message: '新闻 ID 无效' });
  }

  const pool = getPool();
  const authUser = await getAuthUser(req);
  const [rows] = await pool.execute(
    `SELECT
      id,
      title,
      summary,
      source,
      category,
      content,
      views,
      comments_count AS commentsCount,
      likes_count AS likesCount,
      shares_count AS sharesCount,
      published_at AS publishedAt
    FROM news_items
    WHERE id = ?
    LIMIT 1`,
    [newsId]
  );

  const news = rows[0];
  if (!news) {
    return res.status(404).json({ message: '新闻不存在' });
  }
  if (news.moderationStatus === 'hidden' && !isModerator(authUser)) {
    return res.status(404).json({ message: '新闻不存在' });
  }

  await pool.execute('UPDATE news_items SET views = views + 1 WHERE id = ?', [newsId]);

  const [commentRows, reactionState, prevRows, nextRows] = await Promise.all([
    pool.execute(
      `SELECT
        c.id,
        c.content,
        c.created_at AS createdAt,
        u.id AS userId,
        u.username,
        u.level,
        u.city
      FROM news_comments c
      INNER JOIN users u ON u.id = c.user_id
      WHERE c.news_id = ?
      ORDER BY c.created_at ASC, c.id ASC
      LIMIT 100`,
      [newsId]
    ).then(([items]) => items),
    fetchNewsReactionState(pool, newsId, authUser?.id || 0),
    pool.execute(
      `SELECT id, title
      FROM news_items
      WHERE published_at > ?
      ORDER BY published_at ASC
      LIMIT 1`,
      [news.publishedAt]
    ).then(([items]) => items),
    pool.execute(
      `SELECT id, title
      FROM news_items
      WHERE published_at < ?
      ORDER BY published_at DESC
      LIMIT 1`,
      [news.publishedAt]
    ).then(([items]) => items)
  ]);

  return res.json({
    news: {
      ...news,
      content: news.content || news.summary,
      views: news.views + 1,
      publishedLabel: toRelativeTime(news.publishedAt),
      ...reactionState
    },
    comments: commentRows.map((item) => ({
      ...item,
      publishedLabel: toRelativeTime(item.createdAt)
    })),
    previous: prevRows[0] || null,
    next: nextRows[0] || null
  });
});

router.post('/news/:id/comments', async (req, res) => {
  const user = await requireAuth(req, res);
  if (!user) {
    return;
  }

  const newsId = Number(req.params.id);
  if (!Number.isInteger(newsId) || newsId <= 0) {
    return res.status(400).json({ message: '新闻 ID 无效' });
  }

  const parsed = createNewsCommentSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: '新闻评论参数校验失败', errors: parsed.error.issues });
  }

  const pool = getPool();
  const [newsRows] = await pool.execute('SELECT id, title FROM news_items WHERE id = ? LIMIT 1', [newsId]);
  const news = newsRows[0];
  if (!news) {
    return res.status(404).json({ message: '新闻不存在' });
  }

  const [result] = await pool.execute(
    'INSERT INTO news_comments (news_id, user_id, content) VALUES (?, ?, ?)',
    [newsId, user.id, parsed.data.content]
  );
  await syncNewsCommentCounts(pool, newsId);

  const [rows] = await pool.execute(
    `SELECT
      c.id,
      c.content,
      c.created_at AS createdAt,
      u.id AS userId,
      u.username,
      u.level,
      u.city
    FROM news_comments c
    INNER JOIN users u ON u.id = c.user_id
    WHERE c.id = ?
    LIMIT 1`,
    [result.insertId]
  );

  return res.status(201).json({
    message: '新闻评论发布成功',
    comment: {
      ...rows[0],
      publishedLabel: toRelativeTime(rows[0].createdAt)
    }
  });
});

router.post('/news/:id/reactions/:type', async (req, res) => {
  const user = await requireAuth(req, res);
  if (!user) {
    return;
  }

  const newsId = Number(req.params.id);
  const type = req.params.type;
  if (!Number.isInteger(newsId) || newsId <= 0) {
    return res.status(400).json({ message: '新闻 ID 无效' });
  }
  if (!['like', 'share'].includes(type)) {
    return res.status(400).json({ message: '新闻互动类型无效' });
  }

  const pool = getPool();
  const [newsRows] = await pool.execute(
    'SELECT id, likes_count AS likesCount, shares_count AS sharesCount FROM news_items WHERE id = ? LIMIT 1',
    [newsId]
  );
  const news = newsRows[0];
  if (!news) {
    return res.status(404).json({ message: '新闻不存在' });
  }

  if (type === 'share') {
    await pool.execute('UPDATE news_items SET shares_count = shares_count + 1 WHERE id = ?', [newsId]);
    const [countRows] = await pool.execute(
      'SELECT likes_count AS likesCount, shares_count AS sharesCount FROM news_items WHERE id = ? LIMIT 1',
      [newsId]
    );
    return res.json({
      message: '新闻分享次数已记录',
      active: true,
      counts: countRows[0]
    });
  }

  const [rows] = await pool.execute(
    'SELECT id FROM news_reactions WHERE news_id = ? AND user_id = ? AND reaction_type = ? LIMIT 1',
    [newsId, user.id, type]
  );

  let active = false;
  if (rows[0]) {
    await pool.execute('DELETE FROM news_reactions WHERE id = ?', [rows[0].id]);
  } else {
    await pool.execute(
      'INSERT INTO news_reactions (news_id, user_id, reaction_type) VALUES (?, ?, ?)',
      [newsId, user.id, type]
    );
    active = true;
  }

  await syncNewsReactionCounts(pool, newsId);
  const [countRows] = await pool.execute(
    'SELECT likes_count AS likesCount, shares_count AS sharesCount FROM news_items WHERE id = ? LIMIT 1',
    [newsId]
  );

  return res.json({
    message: active ? '新闻点赞成功' : '已取消新闻点赞',
    active,
    counts: countRows[0]
  });
});

router.get('/matches/:id', async (req, res) => {
  const matchId = Number(req.params.id);
  if (!Number.isInteger(matchId) || matchId <= 0) {
    return res.status(400).json({ message: '赛事 ID 无效' });
  }

  const pool = getPool();
  const authUser = await getAuthUser(req);
  const [rows] = await pool.execute(
    `SELECT
      id,
      title,
      match_type AS matchType,
      location,
      start_time AS startTime,
      status,
      highlight,
      participants,
      content,
      current_score AS currentScore,
      score_timeline AS scoreTimeline
    FROM matches
    WHERE id = ?
    LIMIT 1`,
    [matchId]
  );

  const match = rows[0];
  if (!match) {
    return res.status(404).json({ message: '赛事不存在' });
  }

  const [commentRows, reminderRows, prevRows, nextRows] = await Promise.all([
    pool.execute(
      `SELECT
        c.id,
        c.content,
        c.created_at AS createdAt,
        u.id AS userId,
        u.username,
        u.level,
        u.city
      FROM match_comments c
      INNER JOIN users u ON u.id = c.user_id
      WHERE c.match_id = ?
      ORDER BY c.created_at ASC, c.id ASC
      LIMIT 100`,
      [matchId]
    ).then(([items]) => items),
    pool.execute(
      `SELECT
        COUNT(*) AS reminderCount,
        SUM(CASE WHEN user_id = ? THEN 1 ELSE 0 END) AS isSubscribed
      FROM match_reminders
      WHERE match_id = ?`,
      [authUser?.id || 0, matchId]
    ).then(([items]) => items),
    pool.execute(
      `SELECT id, title
      FROM matches
      WHERE start_time > ?
      ORDER BY start_time ASC
      LIMIT 1`,
      [match.startTime]
    ).then(([items]) => items),
    pool.execute(
      `SELECT id, title
      FROM matches
      WHERE start_time < ?
      ORDER BY start_time DESC
      LIMIT 1`,
      [match.startTime]
    ).then(([items]) => items)
  ]);

  let timeline = [];
  try {
    timeline = JSON.parse(match.scoreTimeline || '[]');
  } catch (error) {
    timeline = [];
  }

  return res.json({
    match: {
      ...match,
      content: match.content || match.highlight,
      timeline,
      publishedLabel: toRelativeTime(match.startTime),
      reminderCount: Number(reminderRows[0]?.reminderCount || 0),
      isSubscribed: Boolean(Number(reminderRows[0]?.isSubscribed || 0))
    },
    comments: commentRows.map((item) => ({
      ...item,
      publishedLabel: toRelativeTime(item.createdAt)
    })),
    previous: prevRows[0] || null,
    next: nextRows[0] || null
  });
});

router.get('/venues/:id', async (req, res) => {
  const venueId = Number(req.params.id);
  if (!Number.isInteger(venueId) || venueId <= 0) {
    return res.status(400).json({ message: '场馆 ID 无效' });
  }

  const pool = getPool();
  const authUser = await getAuthUser(req);
  const detail = await fetchVenueDetail(pool, venueId, authUser?.id || 0);
  if (!detail) {
    return res.status(404).json({ message: '场馆不存在' });
  }

  return res.json(detail);
});

router.post('/venues/:id/favorite', async (req, res) => {
  const user = await requireAuth(req, res);
  if (!user) {
    return;
  }

  const venueId = Number(req.params.id);
  if (!Number.isInteger(venueId) || venueId <= 0) {
    return res.status(400).json({ message: '场馆 ID 无效' });
  }

  const pool = getPool();
  const detail = await fetchVenueDetail(pool, venueId, user.id);
  if (!detail) {
    return res.status(404).json({ message: '场馆不存在' });
  }

  const [rows] = await pool.execute(
    'SELECT id FROM venue_favorites WHERE venue_id = ? AND user_id = ? LIMIT 1',
    [venueId, user.id]
  );

  let active = false;
  if (rows[0]) {
    await pool.execute('DELETE FROM venue_favorites WHERE id = ?', [rows[0].id]);
  } else {
    await pool.execute('INSERT INTO venue_favorites (venue_id, user_id) VALUES (?, ?)', [venueId, user.id]);
    active = true;
  }

  const [countRows] = await pool.execute(
    'SELECT COUNT(*) AS favoriteCount FROM venue_favorites WHERE venue_id = ?',
    [venueId]
  );

  return res.json({
    message: active ? '场馆已收藏' : '已取消场馆收藏',
    active,
    favoriteCount: Number(countRows[0]?.favoriteCount || 0)
  });
});

router.post('/venues/:id/reviews', async (req, res) => {
  const user = await requireAuth(req, res);
  if (!user) {
    return;
  }

  const venueId = Number(req.params.id);
  if (!Number.isInteger(venueId) || venueId <= 0) {
    return res.status(400).json({ message: '场馆 ID 无效' });
  }

  const parsed = createVenueReviewSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: '场馆评价参数校验失败', errors: parsed.error.issues });
  }

  const pool = getPool();
  const detail = await fetchVenueDetail(pool, venueId, user.id);
  if (!detail) {
    return res.status(404).json({ message: '场馆不存在' });
  }

  const [result] = await pool.execute(
    'INSERT INTO venue_reviews (venue_id, user_id, rating, content) VALUES (?, ?, ?, ?)',
    [venueId, user.id, parsed.data.rating, parsed.data.content]
  );

  const [rows] = await pool.execute(
    `SELECT
      r.id,
      r.rating,
      r.content,
      r.created_at AS createdAt,
      u.id AS userId,
      u.username,
      u.level,
      u.city
    FROM venue_reviews r
    INNER JOIN users u ON u.id = r.user_id
    WHERE r.id = ?
    LIMIT 1`,
    [result.insertId]
  );

  return res.status(201).json({
    message: '场馆评价已发布',
    review: {
      ...rows[0],
      publishedLabel: toRelativeTime(rows[0].createdAt)
    }
  });
});

router.post('/venues/submissions', async (req, res) => {
  const user = await requireAuth(req, res);
  if (!user) {
    return;
  }

  const parsed = createVenueSubmissionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: '场馆提报参数校验失败', errors: parsed.error.issues });
  }

  const pool = getPool();
  await pool.execute(
    `INSERT INTO venue_submissions (user_id, city, name, address, business_hours, price_range, note)
    VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [user.id, parsed.data.city, parsed.data.name, parsed.data.address, parsed.data.businessHours, parsed.data.priceRange, parsed.data.note]
  );

  return res.status(201).json({ message: '场馆信息已提交，等待审核' });
});

router.post('/matches/:id/comments', async (req, res) => {
  const user = await requireAuth(req, res);
  if (!user) {
    return;
  }

  const matchId = Number(req.params.id);
  if (!Number.isInteger(matchId) || matchId <= 0) {
    return res.status(400).json({ message: '赛事 ID 无效' });
  }

  const parsed = createMatchCommentSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: '赛事评论参数校验失败', errors: parsed.error.issues });
  }

  const pool = getPool();
  const [matchRows] = await pool.execute('SELECT id FROM matches WHERE id = ? LIMIT 1', [matchId]);
  if (!matchRows[0]) {
    return res.status(404).json({ message: '赛事不存在' });
  }

  const [result] = await pool.execute(
    'INSERT INTO match_comments (match_id, user_id, content) VALUES (?, ?, ?)',
    [matchId, user.id, parsed.data.content]
  );

  const [rows] = await pool.execute(
    `SELECT
      c.id,
      c.content,
      c.created_at AS createdAt,
      u.id AS userId,
      u.username,
      u.level,
      u.city
    FROM match_comments c
    INNER JOIN users u ON u.id = c.user_id
    WHERE c.id = ?
    LIMIT 1`,
    [result.insertId]
  );

  return res.status(201).json({
    message: '赛事评论发布成功',
    comment: {
      ...rows[0],
      publishedLabel: toRelativeTime(rows[0].createdAt)
    }
  });
});

router.post('/matches/:id/reminder', async (req, res) => {
  const user = await requireAuth(req, res);
  if (!user) {
    return;
  }

  const matchId = Number(req.params.id);
  if (!Number.isInteger(matchId) || matchId <= 0) {
    return res.status(400).json({ message: '赛事 ID 无效' });
  }

  const pool = getPool();
  const [matchRows] = await pool.execute('SELECT id, title FROM matches WHERE id = ? LIMIT 1', [matchId]);
  const match = matchRows[0];
  if (!match) {
    return res.status(404).json({ message: '赛事不存在' });
  }

  const [rows] = await pool.execute(
    'SELECT id FROM match_reminders WHERE match_id = ? AND user_id = ? LIMIT 1',
    [matchId, user.id]
  );

  let active = false;
  if (rows[0]) {
    await pool.execute('DELETE FROM match_reminders WHERE id = ?', [rows[0].id]);
  } else {
    await pool.execute('INSERT INTO match_reminders (match_id, user_id) VALUES (?, ?)', [matchId, user.id]);
    active = true;
    await pool.execute(
      'INSERT INTO notifications (user_id, type, title, body, is_read) VALUES (?, "activity", ?, ?, 0)',
      [user.id, '赛事提醒已设置', `你已订阅《${match.title}》，比赛开始前会收到站内提醒`]
    );
  }

  const [countRows] = await pool.execute(
    'SELECT COUNT(*) AS reminderCount FROM match_reminders WHERE match_id = ?',
    [matchId]
  );

  return res.json({
    message: active ? '赛事提醒已设置' : '已取消赛事提醒',
    active,
    reminderCount: Number(countRows[0]?.reminderCount || 0)
  });
});

router.get('/users/:id', async (req, res) => {
  const authorId = Number(req.params.id);
  if (!Number.isInteger(authorId) || authorId <= 0) {
    return res.status(400).json({ message: '用户 ID 无效' });
  }

  const pool = getPool();
  const authUser = await getAuthUser(req);
  const profile = await fetchAuthorProfileWithViewer(pool, authorId, authUser?.id || 0);
  if (!profile) {
    return res.status(404).json({ message: '用户不存在' });
  }

  return res.json(profile);
});

router.post('/users/:id/follow', async (req, res) => {
  const user = await requireAuth(req, res);
  if (!user) {
    return;
  }

  const authorId = Number(req.params.id);
  if (!Number.isInteger(authorId) || authorId <= 0) {
    return res.status(400).json({ message: '用户 ID 无效' });
  }
  if (authorId === user.id) {
    return res.status(400).json({ message: '不能关注自己' });
  }

  const pool = getPool();
  const [authorRows] = await pool.execute('SELECT id, username FROM users WHERE id = ? LIMIT 1', [authorId]);
  const author = authorRows[0];
  if (!author) {
    return res.status(404).json({ message: '目标用户不存在' });
  }

  const [rows] = await pool.execute(
    'SELECT id FROM user_follows WHERE follower_id = ? AND following_id = ? LIMIT 1',
    [user.id, authorId]
  );

  let active = false;
  if (rows[0]) {
    await pool.execute('DELETE FROM user_follows WHERE id = ?', [rows[0].id]);
  } else {
    await pool.execute(
      'INSERT INTO user_follows (follower_id, following_id) VALUES (?, ?)',
      [user.id, authorId]
    );
    active = true;
    await pool.execute(
      'INSERT INTO notifications (user_id, type, title, body, is_read) VALUES (?, "interaction", ?, ?, 0)',
      [authorId, '你收到了新的关注', `${user.username} 关注了你`]
    );
  }

  const [countRows] = await pool.execute(
    `SELECT
      (SELECT COUNT(*) FROM user_follows WHERE follower_id = ?) AS followingCount,
      (SELECT COUNT(*) FROM user_follows WHERE following_id = ?) AS followerCount`,
    [authorId, authorId]
  );

  return res.json({
    message: active ? '关注成功' : '已取消关注',
    active,
    counts: countRows[0]
  });
});

router.post('/notifications/:id/read', async (req, res) => {
  const user = await requireAuth(req, res);
  if (!user) {
    return;
  }

  const notificationId = Number(req.params.id);
  if (!Number.isInteger(notificationId) || notificationId <= 0) {
    return res.status(400).json({ message: '通知 ID 无效' });
  }

  const pool = getPool();
  const ok = await markNotificationRead(pool, notificationId, user.id);
  if (!ok) {
    return res.status(404).json({ message: '通知不存在' });
  }

  return res.json({ message: '通知已标记为已读' });
});

router.post('/notifications/read-all', async (req, res) => {
  const user = await requireAuth(req, res);
  if (!user) {
    return;
  }

  const pool = getPool();
  await pool.execute('UPDATE notifications SET is_read = 1 WHERE user_id = ?', [user.id]);
  return res.json({ message: '已全部标记为已读' });
});

router.delete('/notifications/read', async (req, res) => {
  const user = await requireAuth(req, res);
  if (!user) {
    return;
  }

  const pool = getPool();
  const cleared = await clearReadNotifications(pool, user.id);
  return res.json({ message: cleared ? `已清空 ${cleared} 条已读通知` : '当前没有可清空的已读通知', cleared });
});

router.get('/admin/moderation', async (req, res) => {
  const user = await requireModerator(req, res);
  if (!user) {
    return;
  }

  const pool = getPool();
  const [
    pendingActivities,
    commentReports,
    venueSubmissions,
    moderatedPosts,
    moderatedNews,
    moderatedMarketplace,
    statsRows,
    auditRows,
    postTrendRows,
    activityTrendRows,
    reportTrendRows,
    moderationTrendRows,
    efficiencyRows
  ] = await Promise.all([
    pool.execute(
      `SELECT
        a.id,
        a.title,
        a.city,
        a.type,
        a.review_status AS reviewStatus,
        a.created_at AS createdAt,
        u.username
      FROM activities a
      INNER JOIN users u ON u.id = a.user_id
      WHERE a.review_status = 'pending'
      ORDER BY a.created_at DESC
      LIMIT 12`
    ).then(([rows]) => rows),
    pool.execute(
      `SELECT
        r.id,
        r.reason,
        r.created_at AS createdAt,
        c.id AS commentId,
        c.post_id AS postId,
        c.content,
        p.title AS postTitle,
        ru.username AS reporterName,
        cu.username AS commentAuthor
      FROM comment_reports r
      INNER JOIN post_comments c ON c.id = r.comment_id
      INNER JOIN posts p ON p.id = c.post_id
      INNER JOIN users ru ON ru.id = r.user_id
      INNER JOIN users cu ON cu.id = c.user_id
      ORDER BY r.created_at DESC
      LIMIT 20`
    ).then(([rows]) => rows),
    pool.execute(
      `SELECT
        s.id,
        s.city,
        s.name,
        s.address,
        s.business_hours AS businessHours,
        s.price_range AS priceRange,
        s.note,
        s.status,
        s.created_at AS createdAt,
        u.username
      FROM venue_submissions s
      INNER JOIN users u ON u.id = s.user_id
      WHERE s.status = 'pending'
      ORDER BY s.created_at DESC
      LIMIT 20`
    ).then(([rows]) => rows),
    pool.execute(
      `SELECT
        p.id,
        p.title,
        p.category,
        p.city,
        p.moderation_status AS moderationStatus,
        p.created_at AS createdAt,
        u.username
      FROM posts p
      INNER JOIN users u ON u.id = p.user_id
      ORDER BY (p.moderation_status = 'hidden') DESC, p.created_at DESC
      LIMIT 12`
    ).then(([rows]) => rows),
    pool.execute(
      `SELECT
        id,
        title,
        source,
        category,
        moderation_status AS moderationStatus,
        published_at AS publishedAt
      FROM news_items
      ORDER BY (moderation_status = 'hidden') DESC, published_at DESC
      LIMIT 12`
    ).then(([rows]) => rows),
    pool.execute(
      `SELECT
        m.id,
        m.title,
        m.category,
        m.city,
        m.status,
        m.moderation_status AS moderationStatus,
        m.created_at AS createdAt,
        u.username
      FROM marketplace_items m
      INNER JOIN users u ON u.id = m.user_id
      ORDER BY (m.moderation_status = 'hidden') DESC, m.created_at DESC
      LIMIT 12`
    ).then(([rows]) => rows),
    pool.execute(
      `SELECT
        (SELECT COUNT(*) FROM users) AS totalUserCount,
        (SELECT COUNT(*) FROM posts WHERE moderation_status = 'visible') AS totalPostCount,
        (SELECT COUNT(*) FROM news_items WHERE moderation_status = 'visible') AS totalNewsCount,
        (SELECT COUNT(*) FROM activities) AS totalActivityCount,
        (SELECT COUNT(*) FROM marketplace_items WHERE moderation_status = 'visible') AS totalMarketplaceCount,
        (SELECT COUNT(*) FROM activities WHERE review_status = 'pending') AS pendingActivityCount,
        (SELECT COUNT(*) FROM comment_reports) AS pendingCommentReportCount,
        (SELECT COUNT(*) FROM venue_submissions WHERE status = 'pending') AS pendingVenueSubmissionCount,
        (SELECT COUNT(*) FROM activities WHERE review_status = 'approved') AS approvedActivityCount,
        (SELECT COUNT(*) FROM activities WHERE review_status = 'rejected') AS rejectedActivityCount,
        (SELECT COUNT(*) FROM venue_submissions WHERE status = 'approved') AS approvedVenueSubmissionCount,
        (SELECT COUNT(*) FROM venue_submissions WHERE status = 'rejected') AS rejectedVenueSubmissionCount,
        (SELECT COUNT(*) FROM posts WHERE moderation_status = 'hidden') AS hiddenPostCount,
        (SELECT COUNT(*) FROM news_items WHERE moderation_status = 'hidden') AS hiddenNewsCount,
        (SELECT COUNT(*) FROM marketplace_items WHERE moderation_status = 'hidden') AS hiddenMarketplaceCount`
    ).then(([rows]) => rows[0]),
    pool.execute(
      `SELECT
        l.id,
        l.target_type AS targetType,
        l.target_id AS targetId,
        l.action,
        l.summary,
        l.reason,
        l.created_at AS createdAt,
        u.username AS actorName
      FROM moderation_logs l
      LEFT JOIN users u ON u.id = l.actor_user_id
      ORDER BY l.created_at DESC
      LIMIT 16`
    ).then(([rows]) => rows),
    pool.execute(
      `SELECT DATE(created_at) AS day, COUNT(*) AS count
      FROM posts
      WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)
      GROUP BY DATE(created_at)
      ORDER BY day ASC`
    ).then(([rows]) => rows),
    pool.execute(
      `SELECT DATE(created_at) AS day, COUNT(*) AS count
      FROM activities
      WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)
      GROUP BY DATE(created_at)
      ORDER BY day ASC`
    ).then(([rows]) => rows),
    pool.execute(
      `SELECT DATE(created_at) AS day, COUNT(*) AS count
      FROM comment_reports
      WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)
      GROUP BY DATE(created_at)
      ORDER BY day ASC`
    ).then(([rows]) => rows),
    pool.execute(
      `SELECT DATE(created_at) AS day, COUNT(*) AS count
      FROM moderation_logs
      WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)
      GROUP BY DATE(created_at)
      ORDER BY day ASC`
    ).then(([rows]) => rows),
    pool.execute(
      `SELECT
        (
          SELECT ROUND(AVG(TIMESTAMPDIFF(MINUTE, r.created_at, x.firstHandledAt)), 1)
          FROM (
            SELECT target_id, MIN(created_at) AS firstHandledAt
            FROM moderation_logs
            WHERE target_type = 'post_comment'
              AND action IN ('delete_comment', 'dismiss_report')
            GROUP BY target_id
          ) x
          INNER JOIN comment_reports r ON r.comment_id = x.target_id
        ) AS avgCommentReportHandleMinutes,
        (
          SELECT ROUND(AVG(TIMESTAMPDIFF(MINUTE, a.created_at, x.firstReviewedAt)), 1)
          FROM (
            SELECT target_id, MIN(created_at) AS firstReviewedAt
            FROM moderation_logs
            WHERE target_type = 'activity'
              AND action IN ('approve', 'reject', 'approved', 'rejected')
            GROUP BY target_id
          ) x
          INNER JOIN activities a ON a.id = x.target_id
        ) AS avgActivityReviewMinutes,
        (
          SELECT COUNT(*)
          FROM moderation_logs
          WHERE created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
        ) AS moderationActionsLast24h,
        (
          SELECT COUNT(*)
          FROM comment_reports
          WHERE created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
        ) AS reportsLast24h`
    ).then(([rows]) => rows)
  ]);

  const trend = buildDailySeries(7, {
    posts: postTrendRows,
    activities: activityTrendRows,
    reports: reportTrendRows,
    handled: moderationTrendRows
  });
  const trendPeaks = trend.reduce((max, item) => ({
    posts: Math.max(max.posts, item.posts),
    activities: Math.max(max.activities, item.activities),
    reports: Math.max(max.reports, item.reports),
    handled: Math.max(max.handled, item.handled)
  }), { posts: 0, activities: 0, reports: 0, handled: 0 });

  return res.json({
    stats: {
      ...statsRows,
      efficiency: efficiencyRows[0] || {},
      trend,
      trendPeaks
    },
    pendingActivities: pendingActivities.map((item) => ({ ...item, publishedLabel: toRelativeTime(item.createdAt) })),
    commentReports: commentReports.map((item) => ({ ...item, publishedLabel: toRelativeTime(item.createdAt) })),
    venueSubmissions: venueSubmissions.map((item) => ({ ...item, publishedLabel: toRelativeTime(item.createdAt) })),
    moderatedPosts: moderatedPosts.map((item) => ({ ...item, publishedLabel: toRelativeTime(item.createdAt) })),
    moderatedNews: moderatedNews.map((item) => ({ ...item, publishedLabel: toRelativeTime(item.publishedAt) })),
    moderatedMarketplace: moderatedMarketplace.map((item) => ({ ...item, publishedLabel: toRelativeTime(item.createdAt) })),
    auditTrail: auditRows.map((item) => ({ ...item, publishedLabel: toRelativeTime(item.createdAt) }))
  });
});

router.post('/admin/comment-reports/:id(\\d+)', async (req, res) => {
  const user = await requireModerator(req, res);
  if (!user) {
    return;
  }

  const reportId = Number(req.params.id);
  if (!Number.isInteger(reportId) || reportId <= 0) {
    return res.status(400).json({ message: '举报 ID 无效' });
  }

  const parsed = moderateCommentReportSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: '举报处理参数无效', errors: parsed.error.issues });
  }

  const pool = getPool();
  const [rows] = await pool.execute(
    `SELECT
      r.id,
      r.comment_id AS commentId,
      r.user_id AS reporterId,
      c.post_id AS postId,
      c.user_id AS commentAuthorId,
      p.title AS postTitle
    FROM comment_reports r
    INNER JOIN post_comments c ON c.id = r.comment_id
    INNER JOIN posts p ON p.id = c.post_id
    WHERE r.id = ?
    LIMIT 1`,
    [reportId]
  );
  const report = rows[0];
  if (!report) {
    return res.status(404).json({ message: '举报不存在' });
  }

  if (parsed.data.action === 'delete_comment') {
    await pool.execute(
      'UPDATE post_comments SET content = ?, deleted_at = NOW() WHERE id = ? AND deleted_at IS NULL',
      ['该评论已因违规被移除', report.commentId]
    );
    await pool.execute('UPDATE posts SET comments_count = GREATEST(comments_count - 1, 0) WHERE id = ?', [report.postId]);
    await pool.execute(
      `INSERT INTO notifications (user_id, type, title, body, target_type, target_id, action_url, is_read)
      VALUES (?, "system", ?, ?, "post_comment", ?, ?, 0)`,
      [
        report.commentAuthorId,
        '你的评论已被处理',
        `你在《${report.postTitle}》下的评论因违规被删除`,
        report.commentId,
        `/posts/${report.postId}?commentId=${report.commentId}`
      ]
    );
  }

  await pool.execute(
    `INSERT INTO notifications (user_id, type, title, body, target_type, target_id, action_url, is_read)
    VALUES (?, "system", ?, ?, "post_comment", ?, ?, 0)`,
    [
      report.reporterId,
      parsed.data.action === 'delete_comment' ? '你举报的评论已处理' : '你举报的评论处理完成',
      parsed.data.action === 'delete_comment'
        ? `《${report.postTitle}》下的被举报评论已被删除`
        : `《${report.postTitle}》下的被举报评论未被判定违规`,
      report.commentId,
      `/posts/${report.postId}?commentId=${report.commentId}`
    ]
  );

  await logModerationAction(pool, {
    actorUserId: user.id,
    targetType: 'post_comment',
    targetId: report.commentId,
    action: parsed.data.action === 'delete_comment' ? 'delete_comment' : 'dismiss_report',
    summary: parsed.data.action === 'delete_comment'
      ? `删除《${report.postTitle}》下的被举报评论`
      : `忽略《${report.postTitle}》下的评论举报`
  });

  await pool.execute('DELETE FROM comment_reports WHERE comment_id = ?', [report.commentId]);
  return res.json({ message: parsed.data.action === 'delete_comment' ? '评论已删除并清空举报' : '举报已忽略并清空' });
});

router.post('/admin/venue-submissions/:id(\\d+)', async (req, res) => {
  const user = await requireModerator(req, res);
  if (!user) {
    return;
  }

  const submissionId = Number(req.params.id);
  if (!Number.isInteger(submissionId) || submissionId <= 0) {
    return res.status(400).json({ message: '提报 ID 无效' });
  }

  const parsed = moderateVenueSubmissionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: '场馆提报处理参数无效', errors: parsed.error.issues });
  }

  const pool = getPool();
  const [rows] = await pool.execute(
    `SELECT id, user_id AS userId, city, name, address, business_hours AS businessHours, price_range AS priceRange, note, status
    FROM venue_submissions
    WHERE id = ?
    LIMIT 1`,
    [submissionId]
  );
  const submission = rows[0];
  if (!submission) {
    return res.status(404).json({ message: '场馆提报不存在' });
  }

  if (parsed.data.action === 'approve') {
    const [cityRows] = await pool.execute('SELECT id FROM cities WHERE name = ? LIMIT 1', [submission.city]);
    const city = cityRows[0];
    if (!city) {
      return res.status(404).json({ message: '提报城市不存在' });
    }

    const [insertResult] = await pool.execute(
      `INSERT INTO venues (city_id, name, address, business_hours, price_range, evaluation)
      VALUES (?, ?, ?, ?, ?, ?)`,
      [city.id, submission.name, submission.address, submission.businessHours, submission.priceRange, submission.note]
    );
    await pool.execute('UPDATE venue_submissions SET status = "approved" WHERE id = ?', [submissionId]);

    await pool.execute(
      `INSERT INTO notifications (user_id, type, title, body, target_type, target_id, action_url, is_read)
      VALUES (?, "system", ?, ?, "venue", ?, ?, 0)`,
      [
        submission.userId,
        '场馆提报已通过',
        `你提交的场馆《${submission.name}》已入库`,
        insertResult.insertId,
        `/venues/${insertResult.insertId}`
      ]
    );
    await logModerationAction(pool, {
      actorUserId: user.id,
      targetType: 'venue_submission',
      targetId: submissionId,
      action: 'approve',
      summary: `通过场馆提报《${submission.name}》`
    });
  } else {
    await pool.execute('UPDATE venue_submissions SET status = "rejected" WHERE id = ?', [submissionId]);
    await pool.execute(
      `INSERT INTO notifications (user_id, type, title, body, target_type, target_id, action_url, is_read)
      VALUES (?, "system", ?, ?, "venue_submission", ?, ?, 0)`,
      [
        submission.userId,
        '场馆提报未通过',
        `你提交的场馆《${submission.name}》未通过审核`,
        submissionId,
        '/?tab=city'
      ]
    );
    await logModerationAction(pool, {
      actorUserId: user.id,
      targetType: 'venue_submission',
      targetId: submissionId,
      action: 'reject',
      summary: `驳回场馆提报《${submission.name}》`
    });
  }

  return res.json({ message: parsed.data.action === 'approve' ? '场馆提报已通过' : '场馆提报已驳回' });
});

router.post('/admin/comment-reports/batch', async (req, res) => {
  const user = await requireModerator(req, res);
  if (!user) {
    return;
  }

  const parsed = moderateBatchSchema.safeParse(req.body);
  if (!parsed.success || !['dismiss', 'delete_comment'].includes(parsed.data.action)) {
    return res.status(400).json({ message: '批量举报处理参数无效', errors: parsed.error?.issues || [] });
  }

  const pool = getPool();
  const [rows] = await pool.execute(
    `SELECT DISTINCT
      r.comment_id AS commentId,
      r.user_id AS reporterId,
      c.post_id AS postId,
      c.user_id AS commentAuthorId,
      p.title AS postTitle
    FROM comment_reports r
    INNER JOIN post_comments c ON c.id = r.comment_id
    INNER JOIN posts p ON p.id = c.post_id`
  );

  const deletedCommentIds = new Set();
  for (const item of rows) {
    if (parsed.data.action === 'delete_comment' && !deletedCommentIds.has(item.commentId)) {
      await pool.execute(
        'UPDATE post_comments SET content = ?, deleted_at = NOW() WHERE id = ? AND deleted_at IS NULL',
        ['该评论已因违规被移除', item.commentId]
      );
      await pool.execute('UPDATE posts SET comments_count = GREATEST(comments_count - 1, 0) WHERE id = ?', [item.postId]);
      deletedCommentIds.add(item.commentId);
      await pool.execute(
        `INSERT INTO notifications (user_id, type, title, body, target_type, target_id, action_url, is_read)
        VALUES (?, "system", ?, ?, "post_comment", ?, ?, 0)`,
        [
          item.commentAuthorId,
          '你的评论已被处理',
          `你在《${item.postTitle}》下的评论因违规被删除`,
          item.commentId,
          `/posts/${item.postId}?commentId=${item.commentId}`
        ]
      );
    }

    await pool.execute(
      `INSERT INTO notifications (user_id, type, title, body, target_type, target_id, action_url, is_read)
      VALUES (?, "system", ?, ?, "post_comment", ?, ?, 0)`,
      [
        item.reporterId,
        parsed.data.action === 'delete_comment' ? '你举报的评论已处理' : '你举报的评论处理完成',
        parsed.data.action === 'delete_comment'
          ? `《${item.postTitle}》下的被举报评论已被删除`
          : `《${item.postTitle}》下的被举报评论未被判定违规`,
        item.commentId,
        `/posts/${item.postId}?commentId=${item.commentId}`
      ]
    );

    await logModerationAction(pool, {
      actorUserId: user.id,
      targetType: 'post_comment',
      targetId: item.commentId,
      action: parsed.data.action === 'delete_comment' ? 'delete_comment' : 'dismiss_report',
      summary: parsed.data.action === 'delete_comment'
        ? `批量删除《${item.postTitle}》下的被举报评论`
        : `批量忽略《${item.postTitle}》下的评论举报`
    });
  }

  await pool.execute('DELETE FROM comment_reports');
  return res.json({ message: parsed.data.action === 'delete_comment' ? '已批量删除被举报评论' : '已批量忽略全部举报' });
});

router.post('/admin/activities/batch', async (req, res) => {
  const user = await requireModerator(req, res);
  if (!user) {
    return;
  }

  const parsed = moderateBatchSchema.safeParse(req.body);
  if (!parsed.success || !['approve', 'reject'].includes(parsed.data.action)) {
    return res.status(400).json({ message: '批量活动处理参数无效', errors: parsed.error?.issues || [] });
  }

  const pool = getPool();
  const [rows] = await pool.execute(
    'SELECT id, user_id AS organizerId, title FROM activities WHERE review_status = "pending"'
  );
  await pool.execute(
    'UPDATE activities SET review_status = ? WHERE review_status = "pending"',
    [parsed.data.action === 'approve' ? 'approved' : 'rejected']
  );
  for (const item of rows) {
    await pool.execute(
      `INSERT INTO notifications (user_id, type, title, body, target_type, target_id, action_url, is_read)
      VALUES (?, "activity", ?, ?, "activity", ?, ?, 0)`,
      [
        item.organizerId,
        parsed.data.action === 'approve' ? '你的活动已通过审核' : '你的活动未通过审核',
        parsed.data.action === 'approve' ? `活动《${item.title}》已进入公开列表` : `活动《${item.title}》未通过审核，请调整后重试`,
        item.id,
        `/activities/${item.id}`
      ]
    );
    await logModerationAction(pool, {
      actorUserId: user.id,
      targetType: 'activity',
      targetId: item.id,
      action: parsed.data.action,
      summary: parsed.data.action === 'approve'
        ? `批量通过活动《${item.title}》`
        : `批量驳回活动《${item.title}》`
    });
  }

  return res.json({ message: parsed.data.action === 'approve' ? '已批量通过待审核活动' : '已批量驳回待审核活动' });
});

router.post('/admin/venue-submissions/batch', async (req, res) => {
  const user = await requireModerator(req, res);
  if (!user) {
    return;
  }

  const parsed = moderateBatchSchema.safeParse(req.body);
  if (!parsed.success || !['approve', 'reject'].includes(parsed.data.action)) {
    return res.status(400).json({ message: '批量场馆提报处理参数无效', errors: parsed.error?.issues || [] });
  }

  const pool = getPool();
  const [rows] = await pool.execute(
    `SELECT
      id,
      user_id AS userId,
      city,
      name,
      address,
      business_hours AS businessHours,
      price_range AS priceRange,
      note
    FROM venue_submissions
    WHERE status = 'pending'
    ORDER BY created_at ASC`
  );

  for (const item of rows) {
    if (parsed.data.action === 'approve') {
      const [cityRows] = await pool.execute('SELECT id FROM cities WHERE name = ? LIMIT 1', [item.city]);
      const city = cityRows[0];
      if (!city) {
        continue;
      }
      const [insertResult] = await pool.execute(
        `INSERT INTO venues (city_id, name, address, business_hours, price_range, evaluation)
        VALUES (?, ?, ?, ?, ?, ?)`,
        [city.id, item.name, item.address, item.businessHours, item.priceRange, item.note]
      );
      await pool.execute('UPDATE venue_submissions SET status = "approved" WHERE id = ?', [item.id]);
      await pool.execute(
        `INSERT INTO notifications (user_id, type, title, body, target_type, target_id, action_url, is_read)
        VALUES (?, "system", ?, ?, "venue", ?, ?, 0)`,
        [
          item.userId,
          '场馆提报已通过',
          `你提交的场馆《${item.name}》已入库`,
          insertResult.insertId,
          `/venues/${insertResult.insertId}`
        ]
      );
      await logModerationAction(pool, {
        actorUserId: user.id,
        targetType: 'venue_submission',
        targetId: item.id,
        action: 'approve',
        summary: `批量通过场馆提报《${item.name}》`
      });
    } else {
      await pool.execute('UPDATE venue_submissions SET status = "rejected" WHERE id = ?', [item.id]);
      await pool.execute(
        `INSERT INTO notifications (user_id, type, title, body, target_type, target_id, action_url, is_read)
        VALUES (?, "system", ?, ?, "venue_submission", ?, ?, 0)`,
        [
          item.userId,
          '场馆提报未通过',
          `你提交的场馆《${item.name}》未通过审核`,
          item.id,
          '/?tab=city'
        ]
      );
      await logModerationAction(pool, {
        actorUserId: user.id,
        targetType: 'venue_submission',
        targetId: item.id,
        action: 'reject',
        summary: `批量驳回场馆提报《${item.name}》`
      });
    }
  }

  return res.json({ message: parsed.data.action === 'approve' ? '已批量通过全部场馆提报' : '已批量驳回全部场馆提报' });
});

router.post('/admin/posts/:id', async (req, res) => {
  const user = await requireModerator(req, res);
  if (!user) {
    return;
  }

  const postId = Number(req.params.id);
  if (!Number.isInteger(postId) || postId <= 0) {
    return res.status(400).json({ message: '帖子 ID 无效' });
  }

  const parsed = moderateVisibilitySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: '帖子审核参数无效', errors: parsed.error.issues });
  }

  const pool = getPool();
  const [rows] = await pool.execute(
    'SELECT id, user_id AS authorId, title FROM posts WHERE id = ? LIMIT 1',
    [postId]
  );
  const post = rows[0];
  if (!post) {
    return res.status(404).json({ message: '帖子不存在' });
  }

  const nextStatus = parsed.data.action === 'hide' ? 'hidden' : 'visible';
  await pool.execute('UPDATE posts SET moderation_status = ? WHERE id = ?', [nextStatus, postId]);
  await pool.execute(
    `INSERT INTO notifications (user_id, type, title, body, target_type, target_id, action_url, is_read)
    VALUES (?, "system", ?, ?, "post", ?, ?, 0)`,
    [
      post.authorId,
      nextStatus === 'hidden' ? '你的帖子已被隐藏' : '你的帖子已恢复展示',
      nextStatus === 'hidden' ? `帖子《${post.title}》因治理处理暂时隐藏` : `帖子《${post.title}》已恢复公开展示`,
      postId,
      `/posts/${postId}`
    ]
  );
  await logModerationAction(pool, {
    actorUserId: user.id,
    targetType: 'post',
    targetId: postId,
    action: nextStatus === 'hidden' ? 'hide' : 'restore',
    summary: nextStatus === 'hidden' ? `隐藏帖子《${post.title}》` : `恢复帖子《${post.title}》`
  });

  return res.json({ message: nextStatus === 'hidden' ? '帖子已隐藏' : '帖子已恢复展示' });
});

router.post('/admin/news/:id', async (req, res) => {
  const user = await requireModerator(req, res);
  if (!user) {
    return;
  }

  const newsId = Number(req.params.id);
  if (!Number.isInteger(newsId) || newsId <= 0) {
    return res.status(400).json({ message: '新闻 ID 无效' });
  }

  const parsed = moderateVisibilitySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: '新闻审核参数无效', errors: parsed.error.issues });
  }

  const pool = getPool();
  const [rows] = await pool.execute('SELECT id, title FROM news_items WHERE id = ? LIMIT 1', [newsId]);
  const news = rows[0];
  if (!news) {
    return res.status(404).json({ message: '新闻不存在' });
  }

  const nextStatus = parsed.data.action === 'hide' ? 'hidden' : 'visible';
  await pool.execute('UPDATE news_items SET moderation_status = ? WHERE id = ?', [nextStatus, newsId]);
  await logModerationAction(pool, {
    actorUserId: user.id,
    targetType: 'news',
    targetId: newsId,
    action: nextStatus === 'hidden' ? 'hide' : 'restore',
    summary: nextStatus === 'hidden' ? `隐藏新闻《${news.title}》` : `恢复新闻《${news.title}》`
  });
  return res.json({ message: nextStatus === 'hidden' ? '新闻已隐藏' : '新闻已恢复展示' });
});

router.post('/admin/marketplace/:id', async (req, res) => {
  const user = await requireModerator(req, res);
  if (!user) {
    return;
  }

  const itemId = Number(req.params.id);
  if (!Number.isInteger(itemId) || itemId <= 0) {
    return res.status(400).json({ message: '交易 ID 无效' });
  }

  const parsed = moderateVisibilitySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: '交易审核参数无效', errors: parsed.error.issues });
  }

  const pool = getPool();
  const [rows] = await pool.execute(
    'SELECT id, user_id AS sellerId, title FROM marketplace_items WHERE id = ? LIMIT 1',
    [itemId]
  );
  const item = rows[0];
  if (!item) {
    return res.status(404).json({ message: '交易不存在' });
  }

  const nextStatus = parsed.data.action === 'hide' ? 'hidden' : 'visible';
  await pool.execute('UPDATE marketplace_items SET moderation_status = ? WHERE id = ?', [nextStatus, itemId]);
  await pool.execute(
    `INSERT INTO notifications (user_id, type, title, body, target_type, target_id, action_url, is_read)
    VALUES (?, "trade", ?, ?, "marketplace", ?, ?, 0)`,
    [
      item.sellerId,
      nextStatus === 'hidden' ? '你的交易已被隐藏' : '你的交易已恢复展示',
      nextStatus === 'hidden' ? `交易《${item.title}》因治理处理暂时下架` : `交易《${item.title}》已恢复公开展示`,
      itemId,
      `/marketplace/${itemId}`
    ]
  );
  await logModerationAction(pool, {
    actorUserId: user.id,
    targetType: 'marketplace',
    targetId: itemId,
    action: nextStatus === 'hidden' ? 'hide' : 'restore',
    summary: nextStatus === 'hidden' ? `隐藏交易《${item.title}》` : `恢复交易《${item.title}》`
  });

  return res.json({ message: nextStatus === 'hidden' ? '交易已隐藏' : '交易已恢复展示' });
});

router.get('/me/dashboard', async (req, res) => {
  const user = await requireAuth(req, res);
  if (!user) {
    return;
  }

  const pool = getPool();
  const dashboard = await fetchMyDashboard(pool, user);
  return res.json(dashboard);
});

router.get('/posts/:id', async (req, res) => {
  const postId = Number(req.params.id);
  if (!Number.isInteger(postId) || postId <= 0) {
    return res.status(400).json({ message: '帖子 ID 无效' });
  }

  const pool = getPool();
  const authUser = await getAuthUser(req);
  const [rows] = await pool.execute(
    `SELECT
      p.id,
      p.title,
      p.summary,
      p.content,
      p.category,
      p.content_type AS contentType,
      p.city,
      p.is_official AS isOfficial,
      p.is_pinned AS isPinned,
      p.views,
      p.comments_count AS commentsCount,
      p.likes_count AS likesCount,
      p.favorites_count AS favoritesCount,
      p.moderation_status AS moderationStatus,
      p.created_at AS createdAt,
      u.id AS authorId,
      u.username,
      u.level,
      u.city AS authorCity,
      u.bio AS authorBio,
      u.avatar_url AS authorAvatarUrl
    FROM posts p
    INNER JOIN users u ON u.id = p.user_id
    WHERE p.id = ?
    LIMIT 1`,
    [postId]
  );

  const post = rows[0];
  if (!post) {
    return res.status(404).json({ message: '帖子不存在' });
  }
  const canViewHiddenPost = Boolean(authUser?.id) && (authUser.id === post.authorId || isModerator(authUser));
  if (post.moderationStatus === 'hidden' && !canViewHiddenPost) {
    return res.status(404).json({ message: '帖子不存在' });
  }

  await pool.execute('UPDATE posts SET views = views + 1 WHERE id = ?', [postId]);
  const [comments, reactionState, authorProfile, recommendations] = await Promise.all([
    fetchPostComments(pool, postId, authUser),
    fetchPostReactionState(pool, postId, authUser?.id || 0),
    fetchAuthorProfile(pool, post.authorId),
    fetchPostRecommendations(pool, post)
  ]);

  return res.json({
    post: {
      ...post,
      views: post.views + 1,
      publishedLabel: toRelativeTime(post.createdAt),
      tags: [`#${post.category}`, `#${post.city}`],
      canManage: Boolean(authUser?.id) && (authUser.id === post.authorId || ['admin', 'super_admin'].includes(authUser.role)),
      ...reactionState
    },
    comments,
    authorProfile,
    recommendations,
    relatedPosts: [
      ...recommendations.authorPosts,
      ...recommendations.tagPosts,
      ...recommendations.cityPosts
    ].slice(0, 6)
  });
});

router.get('/post-drafts/:id', async (req, res) => {
  const user = await requireAuth(req, res);
  if (!user) {
    return;
  }

  const draftId = Number(req.params.id);
  if (!Number.isInteger(draftId) || draftId <= 0) {
    return res.status(400).json({ message: '草稿 ID 无效' });
  }

  const pool = getPool();
  const draft = await fetchPostDraftById(pool, draftId, user.id);
  if (!draft) {
    return res.status(404).json({ message: '草稿不存在' });
  }

  return res.json({
    draft: {
      ...draft,
      publishedLabel: toRelativeTime(draft.updatedAt)
    }
  });
});

router.post('/post-drafts', async (req, res) => {
  const user = await requireAuth(req, res);
  if (!user) {
    return;
  }

  const parsed = savePostDraftSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: '草稿参数校验失败', errors: parsed.error.issues });
  }

  const pool = getPool();
  const payload = parsed.data;

  if (payload.draftId) {
    const draft = await fetchPostDraftById(pool, payload.draftId, user.id);
    if (!draft) {
      return res.status(404).json({ message: '草稿不存在' });
    }

    await pool.execute(
      `UPDATE post_drafts
      SET title = ?, category = ?, content_type = ?, city = ?, summary = ?, content = ?
      WHERE id = ? AND user_id = ?`,
      [payload.title, payload.category, payload.contentType, payload.city, payload.summary, payload.content, payload.draftId, user.id]
    );

    const nextDraft = await fetchPostDraftById(pool, payload.draftId, user.id);
    return res.json({
      message: '草稿已更新',
      draft: {
        ...nextDraft,
        publishedLabel: toRelativeTime(nextDraft.updatedAt)
      }
    });
  }

  const [result] = await pool.execute(
    `INSERT INTO post_drafts (user_id, title, category, content_type, city, summary, content)
    VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [user.id, payload.title, payload.category, payload.contentType, payload.city, payload.summary, payload.content]
  );

  const nextDraft = await fetchPostDraftById(pool, result.insertId, user.id);
  return res.status(201).json({
    message: '草稿已保存',
    draft: {
      ...nextDraft,
      publishedLabel: toRelativeTime(nextDraft.updatedAt)
    }
  });
});

router.delete('/post-drafts/:id', async (req, res) => {
  const user = await requireAuth(req, res);
  if (!user) {
    return;
  }

  const draftId = Number(req.params.id);
  if (!Number.isInteger(draftId) || draftId <= 0) {
    return res.status(400).json({ message: '草稿 ID 无效' });
  }

  const pool = getPool();
  const draft = await fetchPostDraftById(pool, draftId, user.id);
  if (!draft) {
    return res.status(404).json({ message: '草稿不存在' });
  }

  await pool.execute('DELETE FROM post_drafts WHERE id = ? AND user_id = ?', [draftId, user.id]);
  return res.json({ message: '草稿已删除' });
});

router.post('/posts', async (req, res) => {
  const user = await requireAuth(req, res);
  if (!user) {
    return;
  }

  const parsed = createPostSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: '帖子参数校验失败', errors: parsed.error.issues });
  }

  const pool = getPool();
  const payload = parsed.data;
  const [result] = await pool.execute(
    `INSERT INTO posts (
      user_id,
      title,
      category,
      content_type,
      city,
      summary,
      content,
      views,
      comments_count,
      likes_count,
      favorites_count
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0)`,
    [user.id, payload.title, payload.category, payload.contentType, payload.city, payload.summary, payload.content]
  );
  await awardUserExp(pool, user.id, 'post', 5, `发布帖子《${payload.title}》`);
  await syncTaskProgress(pool, user.id, 'post', 1);

  return res.status(201).json({
    id: result.insertId,
    message: '帖子发布成功，已进入社区流'
  });
});

router.put('/posts/:id', async (req, res) => {
  const user = await requireAuth(req, res);
  if (!user) {
    return;
  }

  const postId = Number(req.params.id);
  if (!Number.isInteger(postId) || postId <= 0) {
    return res.status(400).json({ message: '帖子 ID 无效' });
  }

  const parsed = createPostSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: '帖子参数校验失败', errors: parsed.error.issues });
  }

  const pool = getPool();
  const [postRows] = await pool.execute('SELECT id, user_id AS userId FROM posts WHERE id = ? LIMIT 1', [postId]);
  const post = postRows[0];
  if (!post) {
    return res.status(404).json({ message: '帖子不存在' });
  }

  const canManage = post.userId === user.id || ['admin', 'super_admin'].includes(user.role);
  if (!canManage) {
    return res.status(403).json({ message: '你没有编辑这篇帖子的权限' });
  }

  const payload = parsed.data;
  await pool.execute(
    `UPDATE posts
    SET title = ?, category = ?, content_type = ?, city = ?, summary = ?, content = ?
    WHERE id = ?`,
    [payload.title, payload.category, payload.contentType, payload.city, payload.summary, payload.content, postId]
  );

  return res.json({ message: '帖子已更新' });
});

router.delete('/posts/:id', async (req, res) => {
  const user = await requireAuth(req, res);
  if (!user) {
    return;
  }

  const postId = Number(req.params.id);
  if (!Number.isInteger(postId) || postId <= 0) {
    return res.status(400).json({ message: '帖子 ID 无效' });
  }

  const pool = getPool();
  const [postRows] = await pool.execute('SELECT id, user_id AS userId FROM posts WHERE id = ? LIMIT 1', [postId]);
  const post = postRows[0];
  if (!post) {
    return res.status(404).json({ message: '帖子不存在' });
  }

  const canManage = post.userId === user.id || ['admin', 'super_admin'].includes(user.role);
  if (!canManage) {
    return res.status(403).json({ message: '你没有删除这篇帖子的权限' });
  }

  await pool.execute(
    `DELETE cr FROM comment_reactions cr
    INNER JOIN post_comments pc ON pc.id = cr.comment_id
    WHERE pc.post_id = ?`,
    [postId]
  );
  await pool.execute(
    `DELETE cp FROM comment_reports cp
    INNER JOIN post_comments pc ON pc.id = cp.comment_id
    WHERE pc.post_id = ?`,
    [postId]
  );
  await pool.execute('DELETE FROM post_comments WHERE post_id = ?', [postId]);
  await pool.execute('DELETE FROM post_reactions WHERE post_id = ?', [postId]);
  await pool.execute('DELETE FROM posts WHERE id = ?', [postId]);

  return res.json({ message: '帖子已删除' });
});

router.post('/posts/:id/comments', async (req, res) => {
  const user = await requireAuth(req, res);
  if (!user) {
    return;
  }

  const postId = Number(req.params.id);
  if (!Number.isInteger(postId) || postId <= 0) {
    return res.status(400).json({ message: '帖子 ID 无效' });
  }

  const parsed = createCommentSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: '评论参数校验失败', errors: parsed.error.issues });
  }

  const pool = getPool();
  const [postRows] = await pool.execute('SELECT id, user_id AS userId, title FROM posts WHERE id = ? LIMIT 1', [postId]);
  const post = postRows[0];
  if (!post) {
    return res.status(404).json({ message: '帖子不存在' });
  }

  let parentComment = null;
  if (parsed.data.parentId) {
    const [parentRows] = await pool.execute(
      'SELECT id, user_id AS userId, parent_id AS parentId FROM post_comments WHERE id = ? AND post_id = ? LIMIT 1',
      [parsed.data.parentId, postId]
    );
    parentComment = parentRows[0] || null;
    if (!parentComment) {
      return res.status(404).json({ message: '回复目标不存在' });
    }
    if (parentComment.parentId) {
      return res.status(400).json({ message: '当前仅支持两层评论结构，请直接回复主评论' });
    }
  }

  const [result] = await pool.execute(
    'INSERT INTO post_comments (post_id, user_id, parent_id, content) VALUES (?, ?, ?, ?)',
    [postId, user.id, parsed.data.parentId || null, parsed.data.content]
  );
  await pool.execute('UPDATE posts SET comments_count = comments_count + 1 WHERE id = ?', [postId]);

  if (post.userId !== user.id) {
    await pool.execute(
      `INSERT INTO notifications (user_id, type, title, body, target_type, target_id, action_url, is_read)
      VALUES (?, "interaction", ?, ?, "post", ?, ?, 0)`,
      [post.userId, '你的帖子收到了新评论', `${user.username} 评论了《${post.title}》`, postId, `/posts/${postId}?commentId=${result.insertId}`]
    );
  }

  if (parentComment && parentComment.userId !== user.id && parentComment.userId !== post.userId) {
    await pool.execute(
      `INSERT INTO notifications (user_id, type, title, body, target_type, target_id, action_url, is_read)
      VALUES (?, "interaction", ?, ?, "post", ?, ?, 0)`,
      [parentComment.userId, '有人回复了你的评论', `${user.username} 在《${post.title}》里回复了你`, postId, `/posts/${postId}?commentId=${result.insertId}`]
    );
  }
  await awardUserExp(pool, user.id, 'comment', 2, `参与《${post.title}》评论互动`);
  await syncTaskProgress(pool, user.id, 'comment', 1);

  const [commentRows] = await pool.execute(
    `SELECT
      c.id,
      c.parent_id AS parentId,
      c.content,
      c.created_at AS createdAt,
      u.id AS userId,
      u.username,
      u.level,
      u.city,
      pu.id AS replyToUserId,
      pu.username AS replyToUsername
    FROM post_comments c
    INNER JOIN users u ON u.id = c.user_id
    LEFT JOIN post_comments pc ON pc.id = c.parent_id
    LEFT JOIN users pu ON pu.id = pc.user_id
    WHERE c.id = ?
    LIMIT 1`,
    [result.insertId]
  );

  return res.status(201).json({
    message: '评论发布成功',
    comment: {
      ...commentRows[0],
      likesCount: 0,
      isLiked: false,
      isReported: false,
      isDeleted: false,
      canDelete: true,
      replies: [],
      publishedLabel: toRelativeTime(commentRows[0].createdAt)
    }
  });
});

router.post('/posts/:postId/comments/:commentId/reactions/:type', async (req, res) => {
  const user = await requireAuth(req, res);
  if (!user) {
    return;
  }

  const postId = Number(req.params.postId);
  const commentId = Number(req.params.commentId);
  const type = req.params.type;
  if (!Number.isInteger(postId) || postId <= 0 || !Number.isInteger(commentId) || commentId <= 0) {
    return res.status(400).json({ message: '评论参数无效' });
  }
  if (type !== 'like') {
    return res.status(400).json({ message: '评论互动类型无效' });
  }

  const pool = getPool();
  const comment = await fetchCommentById(pool, commentId);
  if (!comment || comment.postId !== postId) {
    return res.status(404).json({ message: '评论不存在' });
  }
  if (comment.deletedAt) {
    return res.status(400).json({ message: '已删除评论不可操作' });
  }

  const [rows] = await pool.execute(
    'SELECT id FROM comment_reactions WHERE comment_id = ? AND user_id = ? AND reaction_type = ? LIMIT 1',
    [commentId, user.id, type]
  );

  let active = false;
  if (rows[0]) {
    await pool.execute('DELETE FROM comment_reactions WHERE id = ?', [rows[0].id]);
  } else {
    await pool.execute(
      'INSERT INTO comment_reactions (comment_id, user_id, reaction_type) VALUES (?, ?, ?)',
      [commentId, user.id, type]
    );
    active = true;
  }

  await syncCommentReactionCounts(pool, commentId);
  const nextComment = await fetchCommentById(pool, commentId);

  return res.json({
    message: active ? '评论点赞成功' : '已取消评论点赞',
    active,
    counts: {
      likesCount: nextComment?.likesCount || 0
    }
  });
});

router.post('/posts/:postId/comments/:commentId/report', async (req, res) => {
  const user = await requireAuth(req, res);
  if (!user) {
    return;
  }

  const postId = Number(req.params.postId);
  const commentId = Number(req.params.commentId);
  if (!Number.isInteger(postId) || postId <= 0 || !Number.isInteger(commentId) || commentId <= 0) {
    return res.status(400).json({ message: '评论参数无效' });
  }

  const pool = getPool();
  const comment = await fetchCommentById(pool, commentId);
  if (!comment || comment.postId !== postId) {
    return res.status(404).json({ message: '评论不存在' });
  }
  if (comment.deletedAt) {
    return res.status(400).json({ message: '已删除评论不可举报' });
  }

  const [rows] = await pool.execute(
    'SELECT id FROM comment_reports WHERE comment_id = ? AND user_id = ? LIMIT 1',
    [commentId, user.id]
  );
  if (rows[0]) {
    return res.status(400).json({ message: '你已经举报过这条评论' });
  }

  await pool.execute(
    'INSERT INTO comment_reports (comment_id, user_id, reason) VALUES (?, ?, ?)',
    [commentId, user.id, '不友善或疑似违规']
  );

  return res.json({
    message: '评论已举报，管理员将尽快处理'
  });
});

router.delete('/posts/:postId/comments/:commentId', async (req, res) => {
  const user = await requireAuth(req, res);
  if (!user) {
    return;
  }

  const postId = Number(req.params.postId);
  const commentId = Number(req.params.commentId);
  if (!Number.isInteger(postId) || postId <= 0 || !Number.isInteger(commentId) || commentId <= 0) {
    return res.status(400).json({ message: '评论参数无效' });
  }

  const pool = getPool();
  const comment = await fetchCommentById(pool, commentId);
  if (!comment || comment.postId !== postId) {
    return res.status(404).json({ message: '评论不存在' });
  }
  if (comment.deletedAt) {
    return res.status(400).json({ message: '该评论已删除' });
  }

  const canDelete = comment.userId === user.id || ['admin', 'super_admin'].includes(user.role);
  if (!canDelete) {
    return res.status(403).json({ message: '你没有删除这条评论的权限' });
  }

  await pool.execute(
    'UPDATE post_comments SET content = ?, deleted_at = NOW() WHERE id = ?',
    ['该评论已删除', commentId]
  );
  await pool.execute('UPDATE posts SET comments_count = GREATEST(comments_count - 1, 0) WHERE id = ?', [postId]);

  return res.json({
    message: '评论已删除'
  });
});

router.post('/posts/:id/reactions/:type', async (req, res) => {
  const user = await requireAuth(req, res);
  if (!user) {
    return;
  }

  const postId = Number(req.params.id);
  const type = req.params.type;
  if (!Number.isInteger(postId) || postId <= 0) {
    return res.status(400).json({ message: '帖子 ID 无效' });
  }
  if (!['like', 'favorite'].includes(type)) {
    return res.status(400).json({ message: '反应类型无效' });
  }

  const pool = getPool();
  const [postRows] = await pool.execute('SELECT id, user_id AS userId, title FROM posts WHERE id = ? LIMIT 1', [postId]);
  const post = postRows[0];
  if (!post) {
    return res.status(404).json({ message: '帖子不存在' });
  }

  const [rows] = await pool.execute(
    'SELECT id FROM post_reactions WHERE post_id = ? AND user_id = ? AND reaction_type = ? LIMIT 1',
    [postId, user.id, type]
  );

  let active = false;
  if (rows[0]) {
    await pool.execute('DELETE FROM post_reactions WHERE id = ?', [rows[0].id]);
  } else {
    await pool.execute(
      'INSERT INTO post_reactions (post_id, user_id, reaction_type) VALUES (?, ?, ?)',
      [postId, user.id, type]
    );
    active = true;
    if (type === 'like' && post.userId !== user.id) {
      await pool.execute(
        `INSERT INTO notifications (user_id, type, title, body, target_type, target_id, action_url, is_read)
        VALUES (?, "interaction", ?, ?, "post", ?, ?, 0)`,
        [post.userId, '你的帖子收到新点赞', `${user.username} 点赞了《${post.title}》`, postId, `/posts/${postId}`]
      );
    }
  }

  await syncPostReactionCounts(pool, postId);
  const [countRows] = await pool.execute(
    'SELECT likes_count AS likesCount, favorites_count AS favoritesCount FROM posts WHERE id = ? LIMIT 1',
    [postId]
  );

  return res.json({
    message: active ? '操作成功' : '已取消',
    active,
    type,
    counts: countRows[0]
  });
});

router.post('/activities', async (req, res) => {
  const user = await requireAuth(req, res);
  if (!user) {
    return;
  }
  if (user.level < 4) {
    return res.status(403).json({ message: '等级 4 及以上才能发布活动' });
  }

  const parsed = createActivitySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: '活动参数校验失败', errors: parsed.error.issues });
  }

  const payload = parsed.data;
  if (new Date(payload.signupDeadline).getTime() >= new Date(payload.startTime).getTime()) {
    return res.status(400).json({ message: '报名截止时间必须早于活动开始时间' });
  }

  const pool = getPool();
  const [result] = await pool.execute(
    `INSERT INTO activities (
      user_id,
      title,
      type,
      city,
      venue_name,
      address,
      start_time,
      signup_deadline,
      capacity,
      signed_count,
      level_limit,
      summary,
      status,
      review_status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 'published', ?)`,
    [
      user.id,
      payload.title,
      payload.type,
      payload.city,
      payload.venueName,
      payload.address,
      new Date(payload.startTime),
      new Date(payload.signupDeadline),
      payload.capacity,
      payload.levelLimit,
      payload.summary,
      ['admin', 'super_admin'].includes(user.role) ? 'approved' : 'pending'
    ]
  );
  await awardUserExp(pool, user.id, 'activity_publish', 8, `发布活动《${payload.title}》`);

  return res.status(201).json({
    id: result.insertId,
    reviewStatus: ['admin', 'super_admin'].includes(user.role) ? 'approved' : 'pending',
    message: ['admin', 'super_admin'].includes(user.role) ? '活动发布成功，已直接发布' : '活动发布成功，当前为待审核状态'
  });
});

router.get('/activities/:id', async (req, res) => {
  const activityId = Number(req.params.id);
  if (!Number.isInteger(activityId) || activityId <= 0) {
    return res.status(400).json({ message: '活动 ID 无效' });
  }

  const pool = getPool();
  const authUser = await getAuthUser(req);
  const [rows] = await pool.execute(
    `SELECT
      a.id,
      a.user_id AS organizerId,
      a.title,
      a.type,
      a.city,
      a.venue_name AS venueName,
      a.address,
      a.start_time AS startTime,
      a.signup_deadline AS signupDeadline,
      a.capacity,
      a.signed_count AS signedCount,
      a.level_limit AS levelLimit,
      a.summary,
      a.status,
      a.review_status AS reviewStatus,
      a.created_at AS createdAt,
      u.username AS organizerName,
      u.level AS organizerLevel,
      u.bio AS organizerBio
    FROM activities a
    INNER JOIN users u ON u.id = a.user_id
    WHERE a.id = ?
    LIMIT 1`,
    [activityId]
  );
  const activity = rows[0];
  if (!activity) {
    return res.status(404).json({ message: '活动不存在' });
  }

  const canManage = Boolean(authUser?.id) && (authUser.id === activity.organizerId || ['admin', 'super_admin'].includes(authUser.role));
  const isVisible = activity.status === 'published' && activity.reviewStatus === 'approved';
  if (!isVisible && !canManage) {
    return res.status(404).json({ message: '活动不存在或未发布' });
  }

  const [participants, comments, registrationRows, feedbackRows, feedbackOwnRows, penalty] = await Promise.all([
    pool.execute(
      `SELECT
        r.id,
        r.created_at AS createdAt,
        u.id AS userId,
        u.username,
        u.level,
        u.city
      FROM activity_registrations r
      INNER JOIN users u ON u.id = r.user_id
      WHERE r.activity_id = ?
      ORDER BY r.created_at ASC
      LIMIT 30`,
      [activityId]
    ).then(([items]) => items.map((item) => ({ ...item, joinedLabel: toRelativeTime(item.createdAt) }))),
    fetchActivityComments(pool, activityId),
    authUser
      ? pool.execute('SELECT id FROM activity_registrations WHERE activity_id = ? AND user_id = ? LIMIT 1', [activityId, authUser.id]).then(([items]) => items)
      : Promise.resolve([]),
    fetchActivityFeedback(pool, activityId),
    authUser
      ? pool.execute('SELECT id FROM activity_feedback WHERE activity_id = ? AND user_id = ? LIMIT 1', [activityId, authUser.id]).then(([items]) => items)
      : Promise.resolve([]),
    fetchActiveActivityPenalty(pool, authUser?.id || 0)
  ]);

  const averageRating = feedbackRows.length
    ? Number((feedbackRows.reduce((sum, item) => sum + Number(item.rating || 0), 0) / feedbackRows.length).toFixed(1))
    : 0;
  const hasStarted = new Date(activity.startTime).getTime() <= Date.now();
  const reminderTime = new Date(new Date(activity.startTime).getTime() - 24 * 60 * 60 * 1000);
  const reminderStatus = !registrationRows[0]
    ? '报名后可收到开始前提醒'
    : (Date.now() >= reminderTime.getTime() ? '已进入提醒窗口，请留意站内消息' : `开始前 1 天提醒，预计 ${reminderTime.toLocaleString('zh-CN')}`);

  return res.json({
    activity: {
      ...activity,
      startLabel: toRelativeTime(activity.startTime),
      deadlineLabel: toRelativeTime(activity.signupDeadline),
      canManage,
      canReview: Boolean(authUser?.id) && ['admin', 'super_admin'].includes(authUser.role),
      visibilityLabel: isVisible ? '公开可见' : '仅发起人/管理员可见',
      isJoined: Boolean(registrationRows[0]),
      isSignupClosed: new Date(activity.signupDeadline).getTime() <= Date.now(),
      hasStarted,
      canLeaveFeedback: Boolean(authUser?.id) && Boolean(registrationRows[0]) && hasStarted && !feedbackOwnRows[0],
      averageRating,
      feedbackCount: feedbackRows.length,
      reminderStatus,
      penaltyStatus: penalty ? `因频繁取消报名，限制至 ${new Date(penalty.blockedUntil).toLocaleString('zh-CN')}` : '',
      notes: buildActivityNotes(activity)
    },
    participants,
    comments,
    feedback: feedbackRows
  });
});

router.put('/activities/:id/manage', async (req, res) => {
  const user = await requireAuth(req, res);
  if (!user) {
    return;
  }

  const activityId = Number(req.params.id);
  if (!Number.isInteger(activityId) || activityId <= 0) {
    return res.status(400).json({ message: '活动 ID 无效' });
  }

  const parsed = manageActivitySchema.safeParse(req.body);
  if (!parsed.success || (!parsed.data.status && !parsed.data.reviewStatus)) {
    return res.status(400).json({ message: '活动管理参数无效', errors: parsed.error?.issues || [] });
  }

  const pool = getPool();
  const [rows] = await pool.execute(
    'SELECT id, user_id AS organizerId, title, status, review_status AS reviewStatus FROM activities WHERE id = ? LIMIT 1',
    [activityId]
  );
  const activity = rows[0];
  if (!activity) {
    return res.status(404).json({ message: '活动不存在' });
  }

  const isOrganizer = activity.organizerId === user.id;
  const isReviewer = ['admin', 'super_admin'].includes(user.role);
  if (!isOrganizer && !isReviewer) {
    return res.status(403).json({ message: '你没有管理该活动的权限' });
  }

  const nextStatus = parsed.data.status || activity.status;
  const nextReviewStatus = parsed.data.reviewStatus || activity.reviewStatus;

  if (parsed.data.reviewStatus && !isReviewer) {
    return res.status(403).json({ message: '只有管理员可以修改审核状态' });
  }
  if (parsed.data.status && !['published', 'closed'].includes(parsed.data.status)) {
    return res.status(400).json({ message: '活动状态无效' });
  }
  if (parsed.data.status && !isOrganizer && !isReviewer) {
    return res.status(403).json({ message: '你没有修改活动状态的权限' });
  }

  await pool.execute(
    'UPDATE activities SET status = ?, review_status = ? WHERE id = ?',
    [nextStatus, nextReviewStatus, activityId]
  );

  if (parsed.data.reviewStatus && isReviewer && activity.organizerId !== user.id) {
    await pool.execute(
      `INSERT INTO notifications (user_id, type, title, body, target_type, target_id, action_url, is_read)
      VALUES (?, "activity", ?, ?, "activity", ?, ?, 0)`,
      [
        activity.organizerId,
        parsed.data.reviewStatus === 'approved' ? '你的活动已通过审核' : '你的活动未通过审核',
        parsed.data.reviewStatus === 'approved'
          ? `活动《${activity.title}》已进入公开列表`
          : `活动《${activity.title}》未通过审核，请调整后重试`,
        activityId,
        `/activities/${activityId}`
      ]
    );
    await logModerationAction(pool, {
      actorUserId: user.id,
      targetType: 'activity',
      targetId: activityId,
      action: parsed.data.reviewStatus,
      summary: parsed.data.reviewStatus === 'approved'
        ? `通过活动《${activity.title}》`
        : `驳回活动《${activity.title}》`
    });
  }

  return res.json({
    message: '活动状态已更新',
    activity: {
      id: activityId,
      status: nextStatus,
      reviewStatus: nextReviewStatus
    }
  });
});

router.post('/activities/:id/register', async (req, res) => {
  const user = await requireAuth(req, res);
  if (!user) {
    return;
  }

  const activityId = Number(req.params.id);
  if (!Number.isInteger(activityId) || activityId <= 0) {
    return res.status(400).json({ message: '活动 ID 无效' });
  }

  const pool = getPool();
  const penalty = await fetchActiveActivityPenalty(pool, user.id);
  if (penalty) {
    return res.status(403).json({ message: `你当前因频繁取消报名被限制参与活动，解封时间：${new Date(penalty.blockedUntil).toLocaleString('zh-CN')}` });
  }

  const [rows] = await pool.execute(
    `SELECT id, capacity, signed_count AS signedCount, level_limit AS levelLimit, signup_deadline AS signupDeadline
    FROM activities
    WHERE id = ? AND status = 'published' AND review_status = 'approved'
    LIMIT 1`,
    [activityId]
  );
  const activity = rows[0];
  if (!activity) {
    return res.status(404).json({ message: '活动不存在或未发布' });
  }
  if (user.level < activity.levelLimit) {
    return res.status(403).json({ message: '当前等级不满足活动报名要求' });
  }
  if (new Date(activity.signupDeadline).getTime() <= Date.now()) {
    return res.status(400).json({ message: '报名已截止' });
  }
  if (activity.signedCount >= activity.capacity) {
    return res.status(400).json({ message: '报名人数已满' });
  }

  try {
    await pool.execute('INSERT INTO activity_registrations (activity_id, user_id) VALUES (?, ?)', [activityId, user.id]);
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ message: '你已报名该活动' });
    }
    throw error;
  }

  await pool.execute('UPDATE activities SET signed_count = signed_count + 1 WHERE id = ?', [activityId]);
  await pool.execute(
    `INSERT INTO notifications (user_id, type, title, body, target_type, target_id, action_url, is_read)
    VALUES (?, "activity", ?, ?, "activity", ?, ?, 0)`,
    [user.id, '活动报名成功', '你已成功报名活动，请在开始前一天留意站内提醒。', activityId, `/activities/${activityId}`]
  );
  await awardUserExp(pool, user.id, 'activity_join', 20, '参与线下活动报名');
  await syncTaskProgress(pool, user.id, 'activity_join', 1);

  return res.status(201).json({ message: '报名成功' });
});

router.delete('/activities/:id/register', async (req, res) => {
  const user = await requireAuth(req, res);
  if (!user) {
    return;
  }

  const activityId = Number(req.params.id);
  if (!Number.isInteger(activityId) || activityId <= 0) {
    return res.status(400).json({ message: '活动 ID 无效' });
  }

  const pool = getPool();
  const [activityRows] = await pool.execute(
    `SELECT id, signup_deadline AS signupDeadline
    FROM activities
    WHERE id = ? AND status = 'published'
    LIMIT 1`,
    [activityId]
  );
  const activity = activityRows[0];
  if (!activity) {
    return res.status(404).json({ message: '活动不存在或未发布' });
  }
  if (new Date(activity.signupDeadline).getTime() <= Date.now()) {
    return res.status(400).json({ message: '报名截止后不可取消' });
  }

  const [rows] = await pool.execute(
    'SELECT id FROM activity_registrations WHERE activity_id = ? AND user_id = ? LIMIT 1',
    [activityId, user.id]
  );
  if (!rows[0]) {
    return res.status(404).json({ message: '你尚未报名该活动' });
  }

  await pool.execute('DELETE FROM activity_registrations WHERE id = ?', [rows[0].id]);
  await pool.execute('UPDATE activities SET signed_count = GREATEST(signed_count - 1, 0) WHERE id = ?', [activityId]);
  await pool.execute(
    `INSERT INTO notifications (user_id, type, title, body, target_type, target_id, action_url, is_read)
    VALUES (?, "activity", ?, ?, "activity", ?, ?, 0)`,
    [user.id, '活动报名已取消', '你已取消本次活动报名，可继续浏览其他线下活动。', activityId, `/activities/${activityId}`]
  );

  const [cancelRows] = await pool.execute(
    `SELECT COUNT(*) AS count
    FROM notifications
    WHERE user_id = ?
      AND type = 'activity'
      AND title = '活动报名已取消'
      AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)`,
    [user.id]
  );
  const recentCancelCount = Number(cancelRows[0]?.count || 0);
  if (recentCancelCount >= 3) {
    const blockedUntil = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const [existingRows] = await pool.execute(
      'SELECT id, blocked_until AS blockedUntil FROM activity_penalties WHERE user_id = ? ORDER BY blocked_until DESC LIMIT 1',
      [user.id]
    );
    if (existingRows[0]) {
      const nextBlockedUntil = new Date(Math.max(new Date(existingRows[0].blockedUntil).getTime(), blockedUntil.getTime()));
      await pool.execute(
        'UPDATE activity_penalties SET reason = ?, blocked_until = ? WHERE id = ?',
        ['近 30 天内多次取消活动报名', nextBlockedUntil, existingRows[0].id]
      );
    } else {
      await pool.execute(
        'INSERT INTO activity_penalties (user_id, reason, blocked_until) VALUES (?, ?, ?)',
        [user.id, '近 30 天内多次取消活动报名', blockedUntil]
      );
    }
    await pool.execute(
      'INSERT INTO notifications (user_id, type, title, body, is_read) VALUES (?, "activity", ?, ?, 0)',
      [user.id, '活动报名权限已限制', `由于近 30 天多次取消报名，你将在 ${blockedUntil.toLocaleString('zh-CN')} 前无法继续报名活动。`]
    );
  }

  return res.json({ message: '已取消报名' });
});

router.post('/activities/:id/comments', async (req, res) => {
  const user = await requireAuth(req, res);
  if (!user) {
    return;
  }

  const activityId = Number(req.params.id);
  if (!Number.isInteger(activityId) || activityId <= 0) {
    return res.status(400).json({ message: '活动 ID 无效' });
  }

  const parsed = createActivityCommentSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: '活动评论参数校验失败', errors: parsed.error.issues });
  }

  const pool = getPool();
  const [rows] = await pool.execute(
    `SELECT id, user_id AS organizerId, title
    FROM activities
    WHERE id = ? AND status = 'published'
    LIMIT 1`,
    [activityId]
  );
  const activity = rows[0];
  if (!activity) {
    return res.status(404).json({ message: '活动不存在或未发布' });
  }

  const [result] = await pool.execute(
    'INSERT INTO activity_comments (activity_id, user_id, content) VALUES (?, ?, ?)',
    [activityId, user.id, parsed.data.content]
  );

  if (activity.organizerId !== user.id) {
    await pool.execute(
      `INSERT INTO notifications (user_id, type, title, body, target_type, target_id, action_url, is_read)
      VALUES (?, "activity", ?, ?, "activity", ?, ?, 0)`,
      [activity.organizerId, '你的活动收到了新评论', `${user.username} 评论了活动《${activity.title}》`, activityId, `/activities/${activityId}`]
    );
  }

  const [commentRows] = await pool.execute(
    `SELECT
      c.id,
      c.content,
      c.created_at AS createdAt,
      u.id AS userId,
      u.username,
      u.level,
      u.city
    FROM activity_comments c
    INNER JOIN users u ON u.id = c.user_id
    WHERE c.id = ?
    LIMIT 1`,
    [result.insertId]
  );

  return res.status(201).json({
    message: '活动评论发布成功',
    comment: {
      ...commentRows[0],
      publishedLabel: toRelativeTime(commentRows[0].createdAt)
    }
  });
});

router.post('/activities/:id/feedback', async (req, res) => {
  const user = await requireAuth(req, res);
  if (!user) {
    return;
  }

  const activityId = Number(req.params.id);
  if (!Number.isInteger(activityId) || activityId <= 0) {
    return res.status(400).json({ message: '活动 ID 无效' });
  }

  const parsed = createActivityFeedbackSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: '活动评价参数校验失败', errors: parsed.error.issues });
  }

  const pool = getPool();
  const [activityRows] = await pool.execute(
    `SELECT id, user_id AS organizerId, title, start_time AS startTime
    FROM activities
    WHERE id = ? AND status = 'published'
    LIMIT 1`,
    [activityId]
  );
  const activity = activityRows[0];
  if (!activity) {
    return res.status(404).json({ message: '活动不存在或未发布' });
  }
  if (new Date(activity.startTime).getTime() > Date.now()) {
    return res.status(400).json({ message: '活动开始后才能提交评价' });
  }

  const [registrationRows] = await pool.execute(
    'SELECT id FROM activity_registrations WHERE activity_id = ? AND user_id = ? LIMIT 1',
    [activityId, user.id]
  );
  if (!registrationRows[0]) {
    return res.status(403).json({ message: '仅已报名用户可提交活动评价' });
  }

  try {
    const [result] = await pool.execute(
      'INSERT INTO activity_feedback (activity_id, user_id, rating, content) VALUES (?, ?, ?, ?)',
      [activityId, user.id, parsed.data.rating, parsed.data.content]
    );

    if (activity.organizerId !== user.id) {
      await pool.execute(
        `INSERT INTO notifications (user_id, type, title, body, target_type, target_id, action_url, is_read)
        VALUES (?, "activity", ?, ?, "activity", ?, ?, 0)`,
        [activity.organizerId, '你的活动收到了新评价', `${user.username} 对活动《${activity.title}》提交了 ${parsed.data.rating} 星评价`, activityId, `/activities/${activityId}`]
      );
    }

    const [feedbackRows] = await pool.execute(
      `SELECT
        f.id,
        f.rating,
        f.content,
        f.created_at AS createdAt,
        u.id AS userId,
        u.username,
        u.level,
        u.city
      FROM activity_feedback f
      INNER JOIN users u ON u.id = f.user_id
      WHERE f.id = ?
      LIMIT 1`,
      [result.insertId]
    );

    return res.status(201).json({
      message: '活动评价提交成功',
      feedback: {
        ...feedbackRows[0],
        publishedLabel: toRelativeTime(feedbackRows[0].createdAt)
      }
    });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ message: '你已提交过本次活动评价' });
    }
    throw error;
  }
});

router.get('/marketplace/:id', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isInteger(itemId) || itemId <= 0) {
    return res.status(400).json({ message: '交易 ID 无效' });
  }

  const pool = getPool();
  const authUser = await getAuthUser(req);
  const [rows] = await pool.execute(
    `SELECT
      m.id,
      m.user_id AS sellerId,
      m.type,
      m.category,
      m.title,
      m.condition_level AS conditionLevel,
      m.price,
      m.city,
      m.summary,
      m.image_url AS imageUrl,
      m.status,
      m.moderation_status AS moderationStatus,
      m.created_at AS createdAt,
      u.username AS sellerName,
      u.level AS sellerLevel,
      u.city AS sellerCity,
      u.bio AS sellerBio
    FROM marketplace_items m
    INNER JOIN users u ON u.id = m.user_id
    WHERE m.id = ?
    LIMIT 1`,
    [itemId]
  );
  const item = rows[0];
  if (!item) {
    return res.status(404).json({ message: '交易信息不存在' });
  }
  const canViewHiddenItem = Boolean(authUser?.id) && (authUser.id === item.sellerId || isModerator(authUser));
  if (item.moderationStatus === 'hidden' && !canViewHiddenItem) {
    return res.status(404).json({ message: '交易信息不存在' });
  }

  const [recommendations, comments] = await Promise.all([
    fetchMarketplaceRecommendations(pool, item),
    fetchMarketplaceComments(pool, itemId)
  ]);
  const imageState = mapMarketplaceImages(item.imageUrl);

  return res.json({
    item: {
      ...item,
      ...imageState,
      canManage: Boolean(authUser?.id) && (authUser.id === item.sellerId || ['admin', 'super_admin'].includes(authUser.role)),
      publishedLabel: toRelativeTime(item.createdAt),
      commentCount: comments.length
    },
    comments,
    recommendations
  });
});

router.post('/marketplace', async (req, res) => {
  const user = await requireAuth(req, res);
  if (!user) {
    return;
  }

  const parsed = createMarketplaceSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: '交易参数校验失败', errors: parsed.error.issues });
  }

  const payload = parsed.data;
  const imageUrls = normalizeImageUrls(payload);
  const pool = getPool();
  const [result] = await pool.execute(
    `INSERT INTO marketplace_items (
      user_id,
      type,
      category,
      title,
      condition_level,
      price,
      city,
      summary,
      image_url,
      status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
    [
      user.id,
      payload.type,
      payload.category,
      payload.title,
      payload.conditionLevel,
      payload.price,
      payload.city,
      payload.summary,
      imageUrls.join('\n')
    ]
  );
  await awardUserExp(pool, user.id, 'marketplace_publish', 15, `发布交易《${payload.title}》`);
  await syncTaskProgress(pool, user.id, 'marketplace_publish', 1);

  return res.status(201).json({ id: result.insertId, message: '交易信息发布成功' });
});

router.put('/marketplace/:id', async (req, res) => {
  const user = await requireAuth(req, res);
  if (!user) {
    return;
  }

  const itemId = Number(req.params.id);
  if (!Number.isInteger(itemId) || itemId <= 0) {
    return res.status(400).json({ message: '交易 ID 无效' });
  }

  const parsed = createMarketplaceSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: '交易参数校验失败', errors: parsed.error.issues });
  }

  const pool = getPool();
  const [rows] = await pool.execute('SELECT id, user_id AS sellerId FROM marketplace_items WHERE id = ? LIMIT 1', [itemId]);
  const item = rows[0];
  if (!item) {
    return res.status(404).json({ message: '交易信息不存在' });
  }
  if (item.sellerId !== user.id && !['admin', 'super_admin'].includes(user.role)) {
    return res.status(403).json({ message: '你没有编辑这条交易的权限' });
  }

  const payload = parsed.data;
  const imageUrls = normalizeImageUrls(payload);
  await pool.execute(
    `UPDATE marketplace_items
    SET type = ?, category = ?, title = ?, condition_level = ?, price = ?, city = ?, summary = ?, image_url = ?
    WHERE id = ?`,
    [
      payload.type,
      payload.category,
      payload.title,
      payload.conditionLevel,
      payload.price,
      payload.city,
      payload.summary,
      imageUrls.join('\n'),
      itemId
    ]
  );

  return res.json({ message: '交易信息已更新' });
});

router.put('/marketplace/:id/status', async (req, res) => {
  const user = await requireAuth(req, res);
  if (!user) {
    return;
  }

  const itemId = Number(req.params.id);
  const { status } = req.body || {};
  if (!Number.isInteger(itemId) || itemId <= 0 || !['active', 'completed'].includes(status)) {
    return res.status(400).json({ message: '交易状态参数无效' });
  }

  const pool = getPool();
  const [rows] = await pool.execute('SELECT id, user_id AS sellerId FROM marketplace_items WHERE id = ? LIMIT 1', [itemId]);
  const item = rows[0];
  if (!item) {
    return res.status(404).json({ message: '交易信息不存在' });
  }
  if (item.sellerId !== user.id && !['admin', 'super_admin'].includes(user.role)) {
    return res.status(403).json({ message: '你没有修改这条交易状态的权限' });
  }

  await pool.execute('UPDATE marketplace_items SET status = ? WHERE id = ?', [status, itemId]);
  return res.json({ message: status === 'completed' ? '交易已标记成交' : '交易已重新上架' });
});

router.delete('/marketplace/:id', async (req, res) => {
  const user = await requireAuth(req, res);
  if (!user) {
    return;
  }

  const itemId = Number(req.params.id);
  if (!Number.isInteger(itemId) || itemId <= 0) {
    return res.status(400).json({ message: '交易 ID 无效' });
  }

  const pool = getPool();
  const [rows] = await pool.execute('SELECT id, user_id AS sellerId FROM marketplace_items WHERE id = ? LIMIT 1', [itemId]);
  const item = rows[0];
  if (!item) {
    return res.status(404).json({ message: '交易信息不存在' });
  }
  if (item.sellerId !== user.id && !['admin', 'super_admin'].includes(user.role)) {
    return res.status(403).json({ message: '你没有删除这条交易的权限' });
  }

  await pool.execute('DELETE FROM marketplace_comments WHERE item_id = ?', [itemId]);
  await pool.execute('DELETE FROM marketplace_items WHERE id = ?', [itemId]);
  return res.json({ message: '交易信息已删除' });
});

router.post('/marketplace/:id/comments', async (req, res) => {
  const user = await requireAuth(req, res);
  if (!user) {
    return;
  }

  const itemId = Number(req.params.id);
  if (!Number.isInteger(itemId) || itemId <= 0) {
    return res.status(400).json({ message: '交易 ID 无效' });
  }

  const parsed = createMarketplaceCommentSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: '交易咨询参数校验失败', errors: parsed.error.issues });
  }

  const pool = getPool();
  const [rows] = await pool.execute(
    `SELECT id, user_id AS sellerId, title, status, moderation_status AS moderationStatus
    FROM marketplace_items
    WHERE id = ?
    LIMIT 1`,
    [itemId]
  );
  const item = rows[0];
  if (!item) {
    return res.status(404).json({ message: '交易信息不存在' });
  }
  if (item.status !== 'active' || item.moderationStatus !== 'visible') {
    return res.status(400).json({ message: '当前交易不可继续咨询' });
  }

  const [result] = await pool.execute(
    'INSERT INTO marketplace_comments (item_id, user_id, content) VALUES (?, ?, ?)',
    [itemId, user.id, parsed.data.content]
  );

  if (item.sellerId !== user.id) {
    await pool.execute(
      `INSERT INTO notifications (user_id, type, title, body, target_type, target_id, action_url, is_read)
      VALUES (?, "trade", ?, ?, "marketplace", ?, ?, 0)`,
      [item.sellerId, '你的交易收到新咨询', `${user.username} 咨询了交易《${item.title}》`, itemId, `/marketplace/${itemId}`]
    );
  }

  const [commentRows] = await pool.execute(
    `SELECT
      c.id,
      c.content,
      c.created_at AS createdAt,
      u.id AS userId,
      u.username,
      u.level,
      u.city
    FROM marketplace_comments c
    INNER JOIN users u ON u.id = c.user_id
    WHERE c.id = ?
    LIMIT 1`,
    [result.insertId]
  );

  return res.status(201).json({
    message: '交易咨询已发布',
    comment: {
      ...commentRows[0],
      publishedLabel: toRelativeTime(commentRows[0].createdAt)
    }
  });
});

router.get('/messages', async (req, res) => {
  const user = await requireAuth(req, res);
  if (!user) {
    return;
  }

  const pool = getPool();
  const conversations = await fetchConversations(pool, user.id);
  return res.json({ conversations });
});

router.post('/messages/conversations', async (req, res) => {
  const user = await requireAuth(req, res);
  if (!user) {
    return;
  }

  const parsed = createConversationSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: '私信会话参数无效', errors: parsed.error.issues });
  }
  if (parsed.data.targetUserId === user.id) {
    return res.status(400).json({ message: '不能给自己发起私信' });
  }

  const pool = getPool();
  const [targetRows] = await pool.execute('SELECT id FROM users WHERE id = ? LIMIT 1', [parsed.data.targetUserId]);
  if (!targetRows[0]) {
    return res.status(404).json({ message: '目标用户不存在' });
  }

  let conversationId;
  try {
    conversationId = await ensureConversation(
      pool,
      user.id,
      parsed.data.targetUserId,
      parsed.data.contextType,
      parsed.data.contextId || null
    );
  } catch (error) {
    if (error.message === 'MARKETPLACE_NOT_FOUND') {
      return res.status(404).json({ message: '关联交易不存在' });
    }
    throw error;
  }

  const detail = await fetchConversationDetail(pool, conversationId, user.id);
  return res.status(201).json(detail);
});

router.get('/messages/:id', async (req, res) => {
  const user = await requireAuth(req, res);
  if (!user) {
    return;
  }

  const conversationId = Number(req.params.id);
  if (!Number.isInteger(conversationId) || conversationId <= 0) {
    return res.status(400).json({ message: '会话 ID 无效' });
  }

  const pool = getPool();
  const detail = await fetchConversationDetail(pool, conversationId, user.id);
  if (!detail) {
    return res.status(404).json({ message: '会话不存在' });
  }

  return res.json(detail);
});

router.post('/messages/:id', async (req, res) => {
  const user = await requireAuth(req, res);
  if (!user) {
    return;
  }

  const conversationId = Number(req.params.id);
  if (!Number.isInteger(conversationId) || conversationId <= 0) {
    return res.status(400).json({ message: '会话 ID 无效' });
  }

  const parsed = createMessageSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: '消息参数无效', errors: parsed.error.issues });
  }

  const pool = getPool();
  const detail = await fetchConversationDetail(pool, conversationId, user.id);
  if (!detail) {
    return res.status(404).json({ message: '会话不存在' });
  }

  const [result] = await pool.execute(
    'INSERT INTO message_entries (conversation_id, sender_id, content, is_read) VALUES (?, ?, ?, 0)',
    [conversationId, user.id, parsed.data.content]
  );
  await pool.execute('UPDATE message_conversations SET updated_at = NOW() WHERE id = ?', [conversationId]);

  if (detail.conversation.peer?.id) {
    await pool.execute(
      'INSERT INTO notifications (user_id, type, title, body, is_read) VALUES (?, "trade", ?, ?, 0)',
      [detail.conversation.peer.id, '你收到了新的私信', `${user.username} 给你发送了一条私信`]
    );
  }

  const [rows] = await pool.execute(
    `SELECT id, sender_id AS senderId, content, is_read AS isRead, created_at AS createdAt
    FROM message_entries
    WHERE id = ?
    LIMIT 1`,
    [result.insertId]
  );

  return res.status(201).json({
    message: '消息发送成功',
    entry: {
      ...rows[0],
      publishedLabel: toRelativeTime(rows[0].createdAt)
    }
  });
});

router.put('/profile', async (req, res) => {
  const user = await requireAuth(req, res);
  if (!user) {
    return;
  }

  const parsed = updateProfileSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: '个人资料参数校验失败', errors: parsed.error.issues });
  }

  const pool = getPool();
  await pool.execute('UPDATE users SET city = ?, bio = ? WHERE id = ?', [parsed.data.city, parsed.data.bio, user.id]);
  return res.json({ message: '个人资料已更新' });
});

module.exports = router;
