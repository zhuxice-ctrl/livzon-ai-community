// server/routes/artifact.js
// 作品资源/制品：真实文件上传（落本地磁盘 public/uploads/artifacts）、列表、流式下载（计数）、详情
// 对象存储可后续平替：storage_url 现指向 /uploads/artifacts/<随机名>，express.static 已直供该目录。
const express = require('express');
const fs = require('fs');
const path = require('path');
const { query } = require('../db');
const { ok, err, ErrorCodes } = require('../contract');
const { checkRules } = require('../validate');
const { authRequired } = require('../middleware/auth');
const { genId, utf8Field } = require('../lib/community-core');

const router = express.Router();

const KINDS = ['video', 'miniprogram', 'skill', 'mcp', 'source', 'file'];
// 制品扩展名白名单（代码包 / 压缩包 / 音视频 / 文档 / 图片）
const ARTIFACT_EXT = new Set([
  'zip', 'tar', 'gz', 'tgz', 'rar', '7z',
  'mp4', 'mov', 'webm', 'mp3', 'wav',
  'pdf', 'docx', 'xlsx', 'pptx', 'txt', 'md',
  'png', 'jpg', 'jpeg', 'gif', 'webp',
  'json', 'js', 'ts', 'py', 'csv', 'html',
]);
const ARTIFACT_DIR = path.join(__dirname, '..', '..', 'public', 'uploads', 'artifacts');
const maxMb = () => parseInt(process.env.ARTIFACT_MAX_MB || '50', 10);

// multer 懒加载（与社区上传同款优雅降级：未装依赖服务器照常启动，端点给友好提示）
function getArtifactUploadMw() {
  try {
    const multer = require('multer');
    return multer({ storage: multer.memoryStorage(), limits: { fileSize: maxMb() * 1024 * 1024 } }).single('file');
  } catch (_) {
    return null;
  }
}

// POST /api/artifacts/upload —— 真实上传（multipart：file + workId/kind/version/guide）
// authRequired + 所有权：仅作品作者(works.user_id===session.userId)或 admin 可挂资源
router.post('/upload', authRequired, (req, res) => {
  const mw = getArtifactUploadMw();
  if (!mw) return res.status(501).json(err(ErrorCodes.MOCK_UNAVAILABLE, '上传未启用：请在 server/ 执行 npm install multer'));
  // 注意：multipart 文本字段(workId/kind/...)由 multer 解析后才进 req.body，校验必须放在 mw 回调内
  mw(req, res, async (e) => {
    if (e) return res.status(400).json(err(ErrorCodes.VALIDATION, e.code === 'LIMIT_FILE_SIZE' ? `文件超过 ${maxMb()}MB 上限` : e.message));
    const rules = {
      workId:   { required: true, type: 'number' },
      kind:     { required: true, type: 'string', enum: KINDS },
      version:  { type: 'string', max: 40 },
      guide:    { type: 'string', max: 4000 },
      origname: { type: 'string', max: 255 }, // 浏览器 file.name 经文本字段无损传递（header filename 会被有损解码）
    };
    const { valid, errors, casted } = checkRules(req.body || {}, rules);
    if (!valid) return res.status(400).json(err(ErrorCodes.VALIDATION, errors.join('；')));
    const f = req.file;
    if (!f) return res.status(400).json(err(ErrorCodes.VALIDATION, '缺少文件字段 file'));
    // 文件名：优先文本字段 origname（UTF-8 无损），回退 header originalname（latin1 还原）
    const orig = (casted.origname && casted.origname.trim()) ? casted.origname.trim() : utf8Field(String(f.originalname || '')).slice(0, 255);
    const ext = (path.extname(orig).toLowerCase().replace(/^\./, '')) || '';
    if (!ARTIFACT_EXT.has(ext)) return res.status(400).json(err(ErrorCodes.VALIDATION, `不支持的文件类型：${ext || '未知'}`));
    try {
      const w = await query(`SELECT id, user_id FROM works WHERE id=$1`, [casted.workId]);
      if (!w.rows.length) return res.status(404).json(err(ErrorCodes.NOT_FOUND, '作品不存在'));
      const isAdmin = req.session.role === 'admin';
      if (!isAdmin && w.rows[0].user_id !== req.session.userId) {
        return res.status(403).json(err(ErrorCodes.PERMISSION, '只能为你自己的作品上传资源'));
      }
      const fname = genId('art') + '.' + ext; // 随机名防路径穿越/防信任原始名
      try { fs.mkdirSync(ARTIFACT_DIR, { recursive: true }); } catch (_) {}
      await fs.promises.writeFile(path.join(ARTIFACT_DIR, fname), f.buffer);
      const r = await query(
        `INSERT INTO artifacts (work_id, kind, filename, version, size, storage_url, checksum, guide)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         RETURNING id, work_id, kind, filename, version, size, storage_url, checksum, guide, downloads, created_at`,
        [casted.workId, casted.kind, orig, utf8Field(casted.version) || 'v1', f.size, '/uploads/artifacts/' + fname, '', utf8Field(casted.guide) || '']);
      res.status(201).json(ok(r.rows[0]));
    } catch (e2) {
      console.error('[artifact.upload]', e2);
      res.status(500).json(err(ErrorCodes.INTERNAL, '文件写入失败'));
    }
  });
});

// POST /api/artifacts —— 登记/上传一个制品（mock：仅写元数据）
router.post('/', async (req, res) => {
  const rules = {
    workId:   { required: true, type: 'number' },
    kind:     { required: true, type: 'string', enum: KINDS },
    filename: { type: 'string', max: 255 },
    version:  { type: 'string', max: 40 },
    size:     { type: 'number' },
    storageUrl: { type: 'string', max: 1000 },
    guide:    { type: 'string', max: 4000 },
    checksum: { type: 'string', max: 128 },
  };
  const { valid, errors, casted } = checkRules(req.body || {}, rules);
  if (!valid) return res.status(400).json(err(ErrorCodes.VALIDATION, errors.join('；')));

  try {
    const w = await query(`SELECT id FROM works WHERE id=$1`, [casted.workId]);
    if (!w.rows.length) return res.status(404).json(err(ErrorCodes.NOT_FOUND, '作品不存在'));

    const storageUrl = casted.storageUrl || '';
    const size = casted.size || 0;
    // mock：无真实文件上传时，用占位 storage_url 标识待接
    const mockUrl = storageUrl || `placeholder://works/${casted.workId}/${casted.filename || 'file'}`;

    const r = await query(
      `INSERT INTO artifacts (work_id, kind, filename, version, size, storage_url, checksum, guide)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, work_id, kind, filename, version, size, storage_url, guide, created_at`,
      [casted.workId, casted.kind, casted.filename || '', casted.version || 'v1', size,
       mockUrl, casted.checksum || '', casted.guide || '']
    );
    res.status(201).json(ok(r.rows[0]));
  } catch (e) {
    console.error('[artifact.post]', e);
    res.status(500).json(err(ErrorCodes.INTERNAL));
  }
});

// GET /api/artifacts?work_id= —— 某作品的资源列表
router.get('/', async (req, res) => {
  const workId = Number(req.query.work_id);
  if (Number.isNaN(workId)) return res.status(400).json(err(ErrorCodes.VALIDATION, 'work_id 非法'));
  try {
    const r = await query(`SELECT id, kind, filename, version, size, storage_url, checksum, guide, downloads, created_at
      FROM artifacts WHERE work_id=$1 ORDER BY created_at DESC`, [workId]);
    res.json(ok({ artifacts: r.rows }));
  } catch (e) {
    console.error('[artifact.list]', e);
    res.status(500).json(err(ErrorCodes.INTERNAL));
  }
});

// GET /api/artifacts/:id —— 单个资源详情（含下载入口）
router.get('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) return res.status(400).json(err(ErrorCodes.VALIDATION, 'id 非法'));
  try {
    const r = await query(`SELECT * FROM artifacts WHERE id=$1`, [id]);
    if (!r.rows.length) return res.status(404).json(err(ErrorCodes.NOT_FOUND, '资源不存在'));
    res.json(ok(r.rows[0]));
  } catch (e) {
    console.error('[artifact.one]', e);
    res.status(500).json(err(ErrorCodes.INTERNAL));
  }
});

// GET /api/artifacts/:id/download —— 登录态真实下载（计数 + 流式本地文件 / 外链 302 / 占位 410）
router.get('/:id/download', authRequired, async (req, res) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) return res.status(400).json(err(ErrorCodes.VALIDATION, 'id 非法'));
  try {
    const r = await query(`SELECT id, filename, storage_url FROM artifacts WHERE id=$1`, [id]);
    const a = r.rows[0];
    if (!a) return res.status(404).json(err(ErrorCodes.NOT_FOUND, '资源不存在'));
    await query('UPDATE artifacts SET downloads=downloads+1 WHERE id=$1', [id]); // 计数（fire 后即继续）
    const url = String(a.storage_url || '');
    if (/^https?:\/\//i.test(url)) return res.redirect(302, url);              // 外链型制品
    if (url.startsWith('/uploads/')) {
      const fp = path.join(ARTIFACT_DIR, path.basename(url));                 // basename 防穿越
      if (!fs.existsSync(fp)) return res.status(410).json(err(ErrorCodes.NOT_FOUND, '文件已不存在'));
      const safe = String(a.filename || ('artifact-' + id)).replace(/[\\/:*?"<>|\r\n]/g, '_');
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="artifact-${id}"; filename*=UTF-8''${encodeURIComponent(safe)}`);
      res.setHeader('Content-Length', fs.statSync(fp).size);
      return fs.createReadStream(fp).on('error', () => res.status(500).end()).pipe(res);
    }
    return res.status(410).json(err(ErrorCodes.MOCK_UNAVAILABLE, '该制品为占位登记，暂无可下载文件'));
  } catch (e) {
    console.error('[artifact.download]', e);
    if (!res.headersSent) res.status(500).json(err(ErrorCodes.INTERNAL));
  }
});

// PATCH /api/artifacts/:id/download —— 下载计数 + 返回下载地址
router.patch('/:id/download', async (req, res) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) return res.status(400).json(err(ErrorCodes.VALIDATION, 'id 非法'));
  try {
    const r = await query(`UPDATE artifacts SET downloads=downloads+1 WHERE id=$1 RETURNING id, storage_url, downloads, version`, [id]);
    if (!r.rows.length) return res.status(404).json(err(ErrorCodes.NOT_FOUND, '资源不存在'));
    res.json(ok(r.rows[0]));
  } catch (e) {
    console.error('[artifact.dl]', e);
    res.status(500).json(err(ErrorCodes.INTERNAL));
  }
});

module.exports = router;
