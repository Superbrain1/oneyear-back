const bcrypt = require('bcryptjs');
const env = require('../config/env');
const { getPool } = require('./mysql');

async function safeAlter(pool, sql) {
  try {
    await pool.execute(sql);
  } catch (error) {
    if (
      error &&
      ['ER_DUP_FIELDNAME', 'ER_DUP_KEYNAME', 'ER_CANT_DROP_FIELD_OR_KEY', 'ER_FK_DUP_NAME'].includes(error.code)
    ) {
      return;
    }
    throw error;
  }
}

async function ensureMasterAdmin(pool) {
  const { username, email, password } = env.masterAdmin;
  if (!username || !email || !password) {
    return;
  }

  const [emailRows] = await pool.execute('SELECT id FROM users WHERE email = ? LIMIT 1', [email]);
  const [usernameRows] = await pool.execute('SELECT id FROM users WHERE username = ? LIMIT 1', [username]);
  const passwordHash = await bcrypt.hash(password, 12);

  const emailUser = emailRows[0] || null;
  const usernameUser = usernameRows[0] || null;

  if (!emailUser && !usernameUser) {
    await pool.execute(
      `INSERT INTO users (
        username,
        email,
        password_hash,
        role,
        city,
        bio,
        level,
        exp
      ) VALUES (?, ?, ?, "super_admin", "上海", "平台主管理员", 10, 1200)`,
      [username, email, passwordHash]
    );
    console.log('[mysql] master admin created');
    return;
  }

  if (emailUser) {
    await pool.execute(
      'UPDATE users SET role = "super_admin", password_hash = ?, level = 10, exp = GREATEST(exp, 1200) WHERE id = ?',
      [passwordHash, emailUser.id]
    );

    if (!usernameUser || usernameUser.id === emailUser.id) {
      await pool.execute('UPDATE users SET username = ? WHERE id = ?', [username, emailUser.id]);
    }

    console.log('[mysql] master admin ensured');
    return;
  }

  await pool.execute(
    'UPDATE users SET email = ?, role = "super_admin", password_hash = ?, level = 10, exp = GREATEST(exp, 1200) WHERE id = ?',
    [email, passwordHash, usernameUser.id]
  );
  console.log('[mysql] master admin ensured');
}

async function ensureDemoUsers(pool) {
  const demos = [
    ['扣杀研究员', 'player1@oneyear.dev', '上海', 7, 640, '反手防守派，周末固定三场球'],
    ['网前节奏官', 'player2@oneyear.dev', '杭州', 5, 380, '热衷双打轮转与发接发'],
    ['后场火力点', 'player3@oneyear.dev', '深圳', 8, 820, '器材党，喜欢实战评测'],
    ['城市组织者', 'player4@oneyear.dev', '成都', 6, 510, '长期组织同城娱乐局']
  ];

  for (const [username, email, city, level, exp, bio] of demos) {
    const [rows] = await pool.execute('SELECT id FROM users WHERE email = ? LIMIT 1', [email]);
    if (rows.length > 0) {
      continue;
    }

    const passwordHash = await bcrypt.hash('12345678', 12);
    await pool.execute(
      `INSERT INTO users (
        username,
        email,
        password_hash,
        city,
        bio,
        level,
        exp
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [username, email, passwordHash, city, bio, level, exp]
    );
  }
}

async function seedPosts(pool) {
  const [rows] = await pool.execute('SELECT COUNT(*) AS count FROM posts');
  if (rows[0].count > 0) {
    return;
  }

  const [users] = await pool.execute('SELECT id, username, city FROM users ORDER BY id ASC LIMIT 4');
  if (users.length === 0) {
    return;
  }

  const now = Date.now();
  const posts = [
    [users[0].id, '上海双打轮转里最容易掉分的三个站位漏洞', '技术讨论', '图文', users[0].city, 1, 0, 2200, 156, 420, 87, '结合最近三场球局，把发接发、封网和中后场补位拆开讲清楚。', '轮转不是站住不动，而是每次出拍后都要给搭档留下可预期的线路。', new Date(now - 1000 * 60 * 55)],
    [users[2].id, '尤尼克斯 AXForce 与 88D 实战对比：连续进攻谁更省力', '装备分享', '图文', users[2].city, 0, 0, 1680, 92, 301, 63, '连续四周上手两支拍，重点说后场借力、网前拦截和容错差异。', '如果你的力量输出不稳定，头重感更强的型号不一定更适合你。', new Date(now - 1000 * 60 * 60 * 6)],
    [users[1].id, '雨天脚步训练打卡，第 12 天终于把启动节奏跑顺了', '日常打卡', '纯文字', users[1].city, 0, 0, 910, 66, 188, 35, '室内做了 25 分钟分腿垫步 + 并步回位，分享一套可复制的节奏训练。', '先把重心压低，再谈速度，否则越快越乱。', new Date(now - 1000 * 60 * 60 * 20)],
    [users[3].id, '成都球友周六约局，2-4 级新手也能打得开心', '赛事吐槽', '视频', users[3].city, 0, 0, 1240, 48, 204, 41, '组局时发现最影响体验的不是水平差距，而是分组和节奏控制。', '低门槛活动的关键，是把局面做成持续有人接得住。', new Date(now - 1000 * 60 * 60 * 30)],
    [users[0].id, '平台四月规则更新：活动贴与交易贴审核口径说明', '官方公告', '纯文字', '上海', 1, 1, 3560, 25, 120, 18, '活动、交易、跨城引流将采用新的审核标签体系，避免信息噪音。', '官方公告仅用于规则和大型活动，不进入热榜计算。', new Date(now - 1000 * 60 * 60 * 3)]
  ];

  for (const post of posts) {
    await pool.execute(
      `INSERT INTO posts (
        user_id,
        title,
        category,
        content_type,
        city,
        is_official,
        is_pinned,
        views,
        comments_count,
        likes_count,
        favorites_count,
        summary,
        content,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      post
    );
  }
}

async function seedComments(pool) {
  const [rows] = await pool.execute('SELECT COUNT(*) AS count FROM post_comments');
  if (rows[0].count > 0) {
    return;
  }

  const [posts] = await pool.execute('SELECT id, user_id FROM posts ORDER BY id ASC LIMIT 3');
  const [users] = await pool.execute('SELECT id, username FROM users ORDER BY id ASC LIMIT 4');
  if (posts.length === 0 || users.length === 0) {
    return;
  }

  const comments = [
    [posts[0].id, users[1]?.id || users[0].id, '发接发和三拍衔接这一段写得很透，尤其适合双打固定搭子一起看。', new Date(Date.now() - 1000 * 60 * 40)],
    [posts[0].id, users[2]?.id || users[0].id, '如果再补一张轮转站位图会更直观，不过现在这版也已经能直接落到球局里。', new Date(Date.now() - 1000 * 60 * 26)],
    [posts[1].id, users[0].id, '88D 的连续压后场确实更稳，但前提还是挥速得跟得上。', new Date(Date.now() - 1000 * 60 * 88)],
    [posts[2].id, users[3]?.id || users[0].id, '这种日常训练贴很有价值，很多人真正缺的是节奏感不是力量。', new Date(Date.now() - 1000 * 60 * 130)]
  ];

  for (const item of comments) {
    await pool.execute(
      'INSERT INTO post_comments (post_id, user_id, content, created_at) VALUES (?, ?, ?, ?)',
      item
    );
  }

  await pool.execute(
    `UPDATE posts p
    SET comments_count = (
      SELECT COUNT(*)
      FROM post_comments c
      WHERE c.post_id = p.id
    )`
  );
}

async function seedNews(pool) {
  const [rows] = await pool.execute('SELECT COUNT(*) AS count FROM news_items');
  if (rows[0].count > 0) {
    return;
  }

  const items = [
    [
      '亚锦赛男双签表出炉，国羽冲击多线晋级',
      '重点看前两轮对阵与决胜局体能分配。',
      '羽界速报',
      '赛事快讯',
      '亚锦赛签表正式公布后，男双项目再次成为讨论焦点。国羽在多个半区都具备冲击深轮次的可能，但真正决定走势的仍然是前两轮的体能消耗与临场调度。\n\n从签表结构看，部分组合首轮就需要面对节奏较快的对手，连续两场高强度对抗后，第三轮的体能回落会直接影响网前抢点效率。对于依赖连续压后场和中前场封网的组合来说，如何在前两轮控制节奏，比单纯追求速胜更重要。\n\n教练组目前更关注的是轮换与伤病管理。若能够平稳通过签表前半段，后续淘汰赛阶段的临场发挥仍值得期待。',
      new Date(Date.now() - 1000 * 60 * 90)
    ],
    [
      '新材料鞋底开始进入业余高频训练场景',
      '更轻的鞋底反馈不错，但耐磨性还需要更长期验证。',
      '装备实验室',
      '装备资讯',
      '越来越多训练鞋开始采用新型发泡与耐磨复合方案，希望同时解决轻量化与侧向支撑的问题。对于每周训练 3 到 5 次的业余球友而言，这类变化最直接的体感是启动更轻、连续并步的疲劳感下降。\n\n但从当前实际反馈来看，优势主要体现在前两个月的脚感阶段，长期耐磨表现仍有待验证。尤其是场地摩擦较大的球馆，鞋底边缘区域磨损速度仍然偏快。\n\n如果你是高频训练用户，选鞋时仍然要优先看足弓支撑和侧向稳定，不能只看重量数字。',
      new Date(Date.now() - 1000 * 60 * 60 * 8)
    ],
    [
      '多地羽毛球馆晚高峰价格继续上浮',
      '同城活动组织者开始改为团购包场来摊薄成本。',
      '城市观察',
      '行业动态',
      '随着场馆租金和能源成本继续走高，多地羽毛球馆晚高峰价格再次出现上调。对普通球友来说，最直接的影响是工作日晚间固定局的成本明显增加。\n\n部分同城活动组织者已经开始采用团购包场的方式，把价格波动控制在可接受范围内。与此同时，一些球友也转向更早时段或周末白天分流。\n\n从行业角度看，价格上涨并不一定意味着供给不足，更可能是场馆经营压力向用户端转移。后续是否会出现更细的会员与拼场机制，值得持续观察。',
      new Date(Date.now() - 1000 * 60 * 60 * 15)
    ]
  ];

  for (const item of items) {
    await pool.execute(
      'INSERT INTO news_items (title, summary, source, category, content, published_at) VALUES (?, ?, ?, ?, ?, ?)',
      item
    );
  }
}

async function seedMatches(pool) {
  const [rows] = await pool.execute('SELECT COUNT(*) AS count FROM matches');
  if (rows[0].count > 0) {
    return;
  }

  const matches = [
    [
      '全国城市羽毛球挑战赛上海站',
      '城市赛',
      '上海闵行体育馆',
      new Date(Date.now() + 1000 * 60 * 60 * 26),
      '报名中',
      '兼顾业余组与公开组，适合同城曝光。',
      168,
      '上海站将率先开启本年度城市羽毛球挑战赛，赛事分为公开组与业余组，赛程安排覆盖周末两天。组织方希望通过更清晰的分组规则，让不同水平选手都能获得稳定比赛体验。\n\n本次赛事的核心看点是双打项目的排兵布阵。由于连续作战密度较高，体能与轮换将成为后续晋级的关键。',
      '未开始',
      '[{"label":"第一局","score":"--"},{"label":"第二局","score":"--"},{"label":"第三局","score":"--"}]'
    ],
    [
      '春季俱乐部对抗联赛杭州分站',
      '俱乐部联赛',
      '杭州星动馆',
      new Date(Date.now() + 1000 * 60 * 60 * 56),
      '即将开始',
      '双打为主，现场开放观赛。',
      96,
      '杭州分站以俱乐部之间的团体对抗为主，强调战术磨合与临场应变。赛事现场开放观赛，适合本地球友了解不同俱乐部的双打体系和训练风格。\n\n赛事方已经公布主要对阵顺序，预计首个比赛日将以小组循环为主，第二天进入淘汰阶段。',
      '未开始',
      '[{"label":"第一局","score":"--"},{"label":"第二局","score":"--"},{"label":"第三局","score":"--"}]'
    ],
    [
      '青少年周末积分赛深圳站',
      '积分赛',
      '深圳湾羽球中心',
      new Date(Date.now() + 1000 * 60 * 60 * 86),
      '开放观赛',
      '关注新生代技术风格和体能趋势。',
      72,
      '深圳站将继续关注青少年球员的技术成熟度与比赛节奏。相比成年组，积分赛更强调基础动作完整度和连续回合处理能力。\n\n本场赛事的价值不只是看结果，更适合观察年轻球员在高压分上的选择是否足够稳定。',
      '未开始',
      '[{"label":"第一局","score":"--"},{"label":"第二局","score":"--"},{"label":"第三局","score":"--"}]'
    ]
  ];

  for (const item of matches) {
    await pool.execute(
      'INSERT INTO matches (title, match_type, location, start_time, status, highlight, participants, content, current_score, score_timeline) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      item
    );
  }
}

async function seedLevelTasks(pool) {
  const [rows] = await pool.execute('SELECT COUNT(*) AS count FROM level_tasks');
  if (rows[0].count > 0) {
    return;
  }

  const tasks = [
    ['发布 1 篇技术帖', 'post', 1, 1, 10, '完成任意一篇帖子发布，建立你的社区存在感'],
    ['完成 3 次评论互动', 'comment', 3, 1, 8, '多参与讨论，比单纯浏览更容易建立熟人感'],
    ['报名 1 次线下活动', 'activity_join', 1, 4, 20, '参与线下活动是经验值提升最快的路径之一'],
    ['发布 1 条交易信息', 'marketplace_publish', 1, 1, 15, '把闲置装备信息发出来，完善交易链路']
  ];

  for (const item of tasks) {
    await pool.execute(
      `INSERT INTO level_tasks (title, task_type, target_count, min_level, reward_exp, description)
      VALUES (?, ?, ?, ?, ?, ?)`,
      item
    );
  }
}

async function seedCities(pool) {
  const [rows] = await pool.execute('SELECT COUNT(*) AS count FROM cities');
  if (rows[0].count > 0) {
    return;
  }

  const cities = [
    ['上海', '一线', 128, 14, 36],
    ['杭州', '新一线', 94, 11, 24],
    ['深圳', '一线', 102, 16, 28],
    ['成都', '新一线', 88, 12, 19]
  ];

  for (const city of cities) {
    await pool.execute(
      'INSERT INTO cities (name, tier, post_count, activity_count, marketplace_count) VALUES (?, ?, ?, ?, ?)',
      city
    );
  }

  const [cityRows] = await pool.execute('SELECT id, name FROM cities');
  const venues = [
    ['飞羽主场', '徐汇区漕溪北路 899 号', '07:00-23:00', '45-85 元/小时', '地胶维护稳定，适合双打训练'],
    ['星动羽球馆', '余杭区文一西路 58 号', '08:00-22:30', '40-72 元/小时', '停车方便，周末档期紧张'],
    ['湾区羽动中心', '南山区后海大道 1188 号', '07:30-23:00', '52-96 元/小时', '灯光优秀，适合比赛'],
    ['西南羽聚场', '高新区天府三街 188 号', '08:00-22:00', '38-68 元/小时', '球友组织密度高']
  ];

  for (let i = 0; i < cityRows.length; i += 1) {
    const city = cityRows[i];
    const venue = venues[i];
    await pool.execute(
      'INSERT INTO venues (city_id, name, address, business_hours, price_range, evaluation) VALUES (?, ?, ?, ?, ?, ?)',
      [city.id, ...venue]
    );
  }
}

async function seedActivities(pool) {
  const [rows] = await pool.execute('SELECT COUNT(*) AS count FROM activities');
  if (rows[0].count > 0) {
    return;
  }

  const [users] = await pool.execute('SELECT id, city, level FROM users ORDER BY id ASC LIMIT 4');
  const items = [
    [users[0].id, '上海周三晚双打提速局', '球友聚会', '上海', '飞羽主场', '徐汇区漕溪北路 899 号', new Date(Date.now() + 1000 * 60 * 60 * 30), new Date(Date.now() + 1000 * 60 * 60 * 22), 20, 12, 2, '偏实战的双打提速局，适合 3-6 级球友。', 'published'],
    [users[3].id, '成都新手友谊赛与规则讲解', '新手教学', '成都', '西南羽聚场', '高新区天府三街 188 号', new Date(Date.now() + 1000 * 60 * 60 * 54), new Date(Date.now() + 1000 * 60 * 60 * 40), 16, 8, 1, '先讲规则与轮转，再进行低压友谊赛。', 'published'],
    [users[1].id, '杭州混双对抗夜', '友谊赛', '杭州', '星动羽球馆', '余杭区文一西路 58 号', new Date(Date.now() + 1000 * 60 * 60 * 70), new Date(Date.now() + 1000 * 60 * 60 * 60), 24, 17, 4, '按水平分场，组织者统一控节奏。', 'published']
  ];

  for (const item of items) {
    await pool.execute(
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
        status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      item
    );
  }
}

async function seedMarketplace(pool) {
  const [rows] = await pool.execute('SELECT COUNT(*) AS count FROM marketplace_items');
  if (rows[0].count > 0) {
    return;
  }

  const [users] = await pool.execute('SELECT id, city FROM users ORDER BY id ASC LIMIT 4');
  const items = [
    [users[2].id, '出售', '羽毛球拍', 'Yonex 88D 二代 3UG5', '9 成新', 980, users[2].city, '半年使用，无磕碰，附原装拍套。', '', 'active'],
    [users[1].id, '求购', '羽毛球鞋', '求购 43 码稳定型羽毛球鞋', '8 成新以上', 420, users[1].city, '预算 400 左右，偏保护脚踝。', '', 'active'],
    [users[0].id, '出售', '配件', '比赛级鹅毛球两桶', '全新', 168, users[0].city, '团购多出的两桶，支持同城面交。', '', 'active']
  ];

  for (const item of items) {
    await pool.execute(
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
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      item
    );
  }
}

async function seedNotifications(pool) {
  const [rows] = await pool.execute('SELECT COUNT(*) AS count FROM notifications');
  if (rows[0].count > 0) {
    return;
  }

  const [users] = await pool.execute('SELECT id FROM users ORDER BY id ASC LIMIT 4');
  if (users.length === 0) {
    return;
  }

  const firstUserId = users[0].id;
  const notices = [
    [firstUserId, 'system', '四月平台规则更新', '活动贴、交易贴将采用新的审核标签体系。', 0, new Date(Date.now() - 1000 * 60 * 50)],
    [firstUserId, 'activity', '你报名的周三晚双打提速局已通过审核', '活动仍可在截止前取消报名，经验值会自动返还。', 0, new Date(Date.now() - 1000 * 60 * 160)],
    [firstUserId, 'interaction', '你的技术贴进入本周热榜前十', '继续保持高质量内容，热榜每小时刷新。', 1, new Date(Date.now() - 1000 * 60 * 360)]
  ];

  for (const notice of notices) {
    await pool.execute(
      'INSERT INTO notifications (user_id, type, title, body, is_read, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      notice
    );
  }
}

async function initSchema() {
  const pool = getPool();

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      username VARCHAR(50) NOT NULL UNIQUE,
      email VARCHAR(120) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      role ENUM('user', 'admin', 'super_admin') NOT NULL DEFAULT 'user',
      city VARCHAR(40) NOT NULL DEFAULT '上海',
      bio VARCHAR(255) NOT NULL DEFAULT '这个人很低调，但每周都在打球',
      level INT NOT NULL DEFAULT 1,
      exp INT NOT NULL DEFAULT 0,
      avatar_url VARCHAR(255) NOT NULL DEFAULT '',
      banner_url VARCHAR(255) NOT NULL DEFAULT '',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await safeAlter(pool, "ALTER TABLE users ADD COLUMN role ENUM('user', 'admin', 'super_admin') NOT NULL DEFAULT 'user' AFTER password_hash");
  await safeAlter(pool, "ALTER TABLE users ADD COLUMN city VARCHAR(40) NOT NULL DEFAULT '上海' AFTER role");
  await safeAlter(pool, "ALTER TABLE users ADD COLUMN bio VARCHAR(255) NOT NULL DEFAULT '这个人很低调，但每周都在打球' AFTER city");
  await safeAlter(pool, 'ALTER TABLE users ADD COLUMN level INT NOT NULL DEFAULT 1 AFTER bio');
  await safeAlter(pool, 'ALTER TABLE users ADD COLUMN exp INT NOT NULL DEFAULT 0 AFTER level');
  await safeAlter(pool, "ALTER TABLE users ADD COLUMN avatar_url VARCHAR(255) NOT NULL DEFAULT '' AFTER exp");
  await safeAlter(pool, "ALTER TABLE users ADD COLUMN banner_url VARCHAR(255) NOT NULL DEFAULT '' AFTER avatar_url");

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS exp_logs (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      user_id BIGINT NOT NULL,
      action_type VARCHAR(40) NOT NULL,
      delta_exp INT NOT NULL DEFAULT 0,
      description VARCHAR(255) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_exp_logs_user (user_id, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS level_records (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      user_id BIGINT NOT NULL,
      previous_level INT NOT NULL,
      next_level INT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_level_records_user (user_id, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS level_tasks (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      title VARCHAR(120) NOT NULL,
      task_type VARCHAR(40) NOT NULL,
      target_count INT NOT NULL DEFAULT 1,
      min_level INT NOT NULL DEFAULT 1,
      reward_exp INT NOT NULL DEFAULT 0,
      description VARCHAR(255) NOT NULL,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_level_tasks_active (is_active, min_level)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS user_task_progress (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      user_id BIGINT NOT NULL,
      task_id BIGINT NOT NULL,
      progress_count INT NOT NULL DEFAULT 0,
      is_completed TINYINT(1) NOT NULL DEFAULT 0,
      completed_at TIMESTAMP NULL DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_user_task (user_id, task_id),
      INDEX idx_user_task_progress_user (user_id, updated_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  await safeAlter(pool, 'ALTER TABLE users ADD COLUMN updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP');

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS circles (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      name VARCHAR(60) NOT NULL,
      type ENUM('system', 'custom') NOT NULL DEFAULT 'custom',
      owner_id BIGINT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS circle_members (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      circle_id BIGINT NOT NULL,
      user_id BIGINT NOT NULL,
      role ENUM('owner', 'member') NOT NULL DEFAULT 'member',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_member (circle_id, user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS invite_audit (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      code_hash VARCHAR(128) NOT NULL,
      circle_id BIGINT NOT NULL,
      action ENUM('generate', 'use') NOT NULL,
      user_id BIGINT NULL,
      ip VARCHAR(64) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS posts (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      user_id BIGINT NOT NULL,
      title VARCHAR(160) NOT NULL,
      category VARCHAR(40) NOT NULL,
      content_type VARCHAR(20) NOT NULL DEFAULT '纯文字',
      city VARCHAR(40) NOT NULL DEFAULT '上海',
      is_official TINYINT(1) NOT NULL DEFAULT 0,
      is_pinned TINYINT(1) NOT NULL DEFAULT 0,
      views INT NOT NULL DEFAULT 0,
      comments_count INT NOT NULL DEFAULT 0,
      likes_count INT NOT NULL DEFAULT 0,
      favorites_count INT NOT NULL DEFAULT 0,
      moderation_status ENUM('visible', 'hidden') NOT NULL DEFAULT 'visible',
      summary VARCHAR(255) NOT NULL,
      content TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_posts_created (created_at),
      INDEX idx_posts_city (city),
      INDEX idx_posts_category (category)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS post_comments (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      post_id BIGINT NOT NULL,
      user_id BIGINT NOT NULL,
      parent_id BIGINT NULL,
      content VARCHAR(1000) NOT NULL,
      likes_count INT NOT NULL DEFAULT 0,
      deleted_at TIMESTAMP NULL DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_post_comments_post (post_id, created_at),
      INDEX idx_post_comments_user (user_id, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await safeAlter(pool, 'ALTER TABLE post_comments ADD COLUMN parent_id BIGINT NULL AFTER user_id');
  await safeAlter(pool, 'ALTER TABLE post_comments ADD COLUMN likes_count INT NOT NULL DEFAULT 0 AFTER content');
  await safeAlter(pool, 'ALTER TABLE post_comments ADD COLUMN deleted_at TIMESTAMP NULL DEFAULT NULL AFTER likes_count');

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS comment_reactions (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      comment_id BIGINT NOT NULL,
      user_id BIGINT NOT NULL,
      reaction_type ENUM('like') NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_comment_user_reaction (comment_id, user_id, reaction_type),
      INDEX idx_comment_reactions_comment (comment_id, reaction_type),
      INDEX idx_comment_reactions_user (user_id, reaction_type)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  await safeAlter(pool, "ALTER TABLE posts ADD COLUMN moderation_status ENUM('visible', 'hidden') NOT NULL DEFAULT 'visible' AFTER favorites_count");

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS comment_reports (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      comment_id BIGINT NOT NULL,
      user_id BIGINT NOT NULL,
      reason VARCHAR(255) NOT NULL DEFAULT '不友善或疑似违规',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_comment_report_user (comment_id, user_id),
      INDEX idx_comment_reports_comment (comment_id, created_at),
      INDEX idx_comment_reports_user (user_id, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS post_reactions (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      post_id BIGINT NOT NULL,
      user_id BIGINT NOT NULL,
      reaction_type ENUM('like', 'favorite') NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_post_user_reaction (post_id, user_id, reaction_type),
      INDEX idx_post_reactions_post (post_id, reaction_type),
      INDEX idx_post_reactions_user (user_id, reaction_type)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS post_drafts (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      user_id BIGINT NOT NULL,
      title VARCHAR(160) NOT NULL DEFAULT '',
      category VARCHAR(40) NOT NULL DEFAULT '技术讨论',
      content_type VARCHAR(20) NOT NULL DEFAULT '图文',
      city VARCHAR(40) NOT NULL DEFAULT '上海',
      summary VARCHAR(255) NOT NULL DEFAULT '',
      content TEXT NOT NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_post_drafts_user (user_id, updated_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS news_items (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      title VARCHAR(160) NOT NULL,
      summary VARCHAR(255) NOT NULL,
      source VARCHAR(80) NOT NULL,
      category VARCHAR(40) NOT NULL,
      content TEXT NULL,
      views INT NOT NULL DEFAULT 0,
      comments_count INT NOT NULL DEFAULT 0,
      likes_count INT NOT NULL DEFAULT 0,
      shares_count INT NOT NULL DEFAULT 0,
      moderation_status ENUM('visible', 'hidden') NOT NULL DEFAULT 'visible',
      published_at DATETIME NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  await safeAlter(pool, 'ALTER TABLE news_items ADD COLUMN content TEXT NULL AFTER category');
  await safeAlter(pool, 'ALTER TABLE news_items ADD COLUMN views INT NOT NULL DEFAULT 0 AFTER content');
  await safeAlter(pool, 'ALTER TABLE news_items ADD COLUMN comments_count INT NOT NULL DEFAULT 0 AFTER views');
  await safeAlter(pool, 'ALTER TABLE news_items ADD COLUMN likes_count INT NOT NULL DEFAULT 0 AFTER comments_count');
  await safeAlter(pool, 'ALTER TABLE news_items ADD COLUMN shares_count INT NOT NULL DEFAULT 0 AFTER likes_count');
  await safeAlter(pool, "ALTER TABLE news_items ADD COLUMN moderation_status ENUM('visible', 'hidden') NOT NULL DEFAULT 'visible' AFTER shares_count");

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS news_comments (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      news_id BIGINT NOT NULL,
      user_id BIGINT NOT NULL,
      content VARCHAR(1000) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_news_comments_news (news_id, created_at),
      INDEX idx_news_comments_user (user_id, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS news_reactions (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      news_id BIGINT NOT NULL,
      user_id BIGINT NOT NULL,
      reaction_type ENUM('like') NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_news_user_reaction (news_id, user_id, reaction_type),
      INDEX idx_news_reactions_news (news_id, reaction_type),
      INDEX idx_news_reactions_user (user_id, reaction_type)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS matches (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      title VARCHAR(160) NOT NULL,
      match_type VARCHAR(40) NOT NULL,
      location VARCHAR(120) NOT NULL,
      start_time DATETIME NOT NULL,
      status VARCHAR(40) NOT NULL,
      highlight VARCHAR(255) NOT NULL,
      participants INT NOT NULL DEFAULT 0,
      content TEXT NULL,
      current_score VARCHAR(80) NOT NULL DEFAULT '未开始',
      score_timeline TEXT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  await safeAlter(pool, 'ALTER TABLE matches ADD COLUMN content TEXT NULL AFTER participants');
  await safeAlter(pool, "ALTER TABLE matches ADD COLUMN current_score VARCHAR(80) NOT NULL DEFAULT '未开始' AFTER content");
  await safeAlter(pool, 'ALTER TABLE matches ADD COLUMN score_timeline TEXT NULL AFTER current_score');

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS match_comments (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      match_id BIGINT NOT NULL,
      user_id BIGINT NOT NULL,
      content VARCHAR(1000) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_match_comments_match (match_id, created_at),
      INDEX idx_match_comments_user (user_id, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS match_reminders (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      match_id BIGINT NOT NULL,
      user_id BIGINT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_match_reminder_user (match_id, user_id),
      INDEX idx_match_reminders_match (match_id, created_at),
      INDEX idx_match_reminders_user (user_id, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS cities (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      name VARCHAR(40) NOT NULL UNIQUE,
      tier VARCHAR(20) NOT NULL,
      post_count INT NOT NULL DEFAULT 0,
      activity_count INT NOT NULL DEFAULT 0,
      marketplace_count INT NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS venues (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      city_id BIGINT NOT NULL,
      name VARCHAR(80) NOT NULL,
      address VARCHAR(160) NOT NULL,
      business_hours VARCHAR(80) NOT NULL,
      price_range VARCHAR(80) NOT NULL,
      evaluation VARCHAR(255) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS venue_reviews (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      venue_id BIGINT NOT NULL,
      user_id BIGINT NOT NULL,
      rating INT NOT NULL DEFAULT 5,
      content VARCHAR(1000) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_venue_reviews_venue (venue_id, created_at),
      INDEX idx_venue_reviews_user (user_id, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS venue_favorites (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      venue_id BIGINT NOT NULL,
      user_id BIGINT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_venue_favorite_user (venue_id, user_id),
      INDEX idx_venue_favorites_venue (venue_id, created_at),
      INDEX idx_venue_favorites_user (user_id, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS venue_submissions (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      user_id BIGINT NOT NULL,
      city VARCHAR(40) NOT NULL,
      name VARCHAR(80) NOT NULL,
      address VARCHAR(160) NOT NULL,
      business_hours VARCHAR(80) NOT NULL,
      price_range VARCHAR(80) NOT NULL,
      note VARCHAR(255) NOT NULL,
      status ENUM('pending', 'approved', 'rejected') NOT NULL DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_venue_submissions_user (user_id, created_at),
      INDEX idx_venue_submissions_status (status, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS activities (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      user_id BIGINT NOT NULL,
      title VARCHAR(160) NOT NULL,
      type VARCHAR(40) NOT NULL,
      city VARCHAR(40) NOT NULL,
      venue_name VARCHAR(80) NOT NULL,
      address VARCHAR(160) NOT NULL,
      start_time DATETIME NOT NULL,
      signup_deadline DATETIME NOT NULL,
      capacity INT NOT NULL DEFAULT 20,
      signed_count INT NOT NULL DEFAULT 0,
      level_limit INT NOT NULL DEFAULT 1,
      summary VARCHAR(255) NOT NULL,
      status ENUM('draft', 'published', 'closed') NOT NULL DEFAULT 'published',
      review_status ENUM('pending', 'approved', 'rejected') NOT NULL DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_activities_city (city),
      INDEX idx_activities_start (start_time)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await safeAlter(
    pool,
    "ALTER TABLE activities ADD COLUMN review_status ENUM('pending', 'approved', 'rejected') NOT NULL DEFAULT 'pending' AFTER status"
  );
  await pool.execute(
    "ALTER TABLE activities MODIFY COLUMN review_status ENUM('pending', 'approved', 'rejected') NOT NULL DEFAULT 'pending'"
  );

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS activity_registrations (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      activity_id BIGINT NOT NULL,
      user_id BIGINT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_activity_user (activity_id, user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS activity_penalties (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      user_id BIGINT NOT NULL,
      reason VARCHAR(255) NOT NULL,
      blocked_until DATETIME NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_activity_penalties_user (user_id, blocked_until)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS activity_comments (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      activity_id BIGINT NOT NULL,
      user_id BIGINT NOT NULL,
      content VARCHAR(1000) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_activity_comments_activity (activity_id, created_at),
      INDEX idx_activity_comments_user (user_id, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS activity_feedback (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      activity_id BIGINT NOT NULL,
      user_id BIGINT NOT NULL,
      rating INT NOT NULL DEFAULT 5,
      content VARCHAR(1000) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_activity_feedback_user (activity_id, user_id),
      INDEX idx_activity_feedback_activity (activity_id, created_at),
      INDEX idx_activity_feedback_user (user_id, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS marketplace_items (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      user_id BIGINT NOT NULL,
      type VARCHAR(20) NOT NULL,
      category VARCHAR(40) NOT NULL,
      title VARCHAR(160) NOT NULL,
      condition_level VARCHAR(40) NOT NULL,
      price DECIMAL(10, 2) NOT NULL DEFAULT 0,
      city VARCHAR(40) NOT NULL,
      summary VARCHAR(255) NOT NULL,
      image_url VARCHAR(255) NOT NULL DEFAULT '',
      status ENUM('active', 'completed') NOT NULL DEFAULT 'active',
      moderation_status ENUM('visible', 'hidden') NOT NULL DEFAULT 'visible',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_marketplace_city (city),
      INDEX idx_marketplace_created (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  await pool.execute('ALTER TABLE marketplace_items MODIFY COLUMN image_url TEXT NOT NULL');
  await safeAlter(pool, "ALTER TABLE marketplace_items ADD COLUMN moderation_status ENUM('visible', 'hidden') NOT NULL DEFAULT 'visible' AFTER status");

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS marketplace_comments (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      item_id BIGINT NOT NULL,
      user_id BIGINT NOT NULL,
      content VARCHAR(1000) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_marketplace_comments_item (item_id, created_at),
      INDEX idx_marketplace_comments_user (user_id, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS notifications (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      user_id BIGINT NOT NULL,
      type VARCHAR(20) NOT NULL,
      title VARCHAR(160) NOT NULL,
      body VARCHAR(255) NOT NULL,
      target_type VARCHAR(40) NULL,
      target_id BIGINT NULL,
      action_url VARCHAR(255) NULL,
      is_read TINYINT(1) NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_notifications_user (user_id, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  await safeAlter(pool, 'ALTER TABLE notifications ADD COLUMN target_type VARCHAR(40) NULL AFTER body');
  await safeAlter(pool, 'ALTER TABLE notifications ADD COLUMN target_id BIGINT NULL AFTER target_type');
  await safeAlter(pool, 'ALTER TABLE notifications ADD COLUMN action_url VARCHAR(255) NULL AFTER target_id');

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS moderation_logs (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      actor_user_id BIGINT NULL,
      target_type VARCHAR(40) NOT NULL,
      target_id BIGINT NOT NULL,
      action VARCHAR(40) NOT NULL,
      summary VARCHAR(255) NOT NULL,
      reason VARCHAR(255) NOT NULL DEFAULT '',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_moderation_logs_created (created_at),
      INDEX idx_moderation_logs_target (target_type, target_id, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS user_follows (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      follower_id BIGINT NOT NULL,
      following_id BIGINT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_user_follow (follower_id, following_id),
      INDEX idx_user_follows_follower (follower_id, created_at),
      INDEX idx_user_follows_following (following_id, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS message_conversations (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      user_low_id BIGINT NOT NULL,
      user_high_id BIGINT NOT NULL,
      context_type VARCHAR(20) NOT NULL DEFAULT 'direct',
      context_id BIGINT NULL,
      context_title VARCHAR(160) NOT NULL DEFAULT '',
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_conversation_pair (user_low_id, user_high_id, context_type, context_id),
      INDEX idx_conversation_updated (updated_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS message_entries (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      conversation_id BIGINT NOT NULL,
      sender_id BIGINT NOT NULL,
      content VARCHAR(1000) NOT NULL,
      is_read TINYINT(1) NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_message_entries_conversation (conversation_id, created_at),
      INDEX idx_message_entries_sender (sender_id, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  const defaults = ['世界', '省', '市', '区'];
  for (const name of defaults) {
    await pool.execute(
      'INSERT INTO circles (name, type) SELECT ?, "system" WHERE NOT EXISTS (SELECT 1 FROM circles WHERE name = ? AND type = "system")',
      [name, name]
    );
  }

  await ensureMasterAdmin(pool);
  await ensureDemoUsers(pool);
  await seedPosts(pool);
  await seedComments(pool);
  await seedNews(pool);
  await seedMatches(pool);
  await seedCities(pool);
  await seedActivities(pool);
  await seedMarketplace(pool);
  await seedNotifications(pool);
  await seedLevelTasks(pool);

  console.log('[mysql] schema initialized');
}

module.exports = {
  initSchema
};
