"""数据库模型与连接（完整版 v3，含商业化表）"""
from sqlalchemy import create_engine, Column, Integer, String, Float, Text, Index, DateTime
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
import datetime
import os
from pathlib import Path

# 勿用 sqlite:///./gaokao.db：./ 相对进程 cwd，与 systemd/启动目录强绑定，易连错库。
# 默认固定为「本文件所在目录下的 gaokao.db」；可选环境变量 DATABASE_URL 覆盖（main 会先加载 .env）
_DEFAULT_DB = Path(__file__).resolve().parent / "gaokao.db"
DATABASE_URL = os.getenv("DATABASE_URL") or f"sqlite:///{_DEFAULT_DB.as_posix()}"
def _set_wal(conn, conn_record):
    """启用 WAL 日志模式，允许并发读写（解决爬虫写入时API读阻塞问题）"""
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")  # WAL下NORMAL已足够安全，性能更好

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False},
    pool_pre_ping=True
)

from sqlalchemy import event
event.listen(engine, "connect", _set_wal)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


class School(Base):
    """院校基础信息 v2"""
    __tablename__ = "schools"
    id              = Column(Integer, primary_key=True, index=True)
    code            = Column(String, unique=True, index=True)
    name            = Column(String, unique=True, index=True)
    province        = Column(String, index=True)
    city            = Column(String)
    tier            = Column(String)
    school_type     = Column(String, default="")
    is_985          = Column(String, default="否")
    is_211          = Column(String, default="否")
    is_shuangyiliu  = Column(String, default="否")
    nature          = Column(String, default="公办")
    postgrad_rate   = Column(String, default="")
    male_ratio      = Column(String, default="")
    female_ratio    = Column(String, default="")
    tags            = Column(Text, default="")
    website         = Column(String, default="")
    intro           = Column(Text, default="")
    # ── 新增字段（Sprint 1.2） ──────────────────────────────────
    rank_2025       = Column(Integer, default=0)    # 2025软科排名
    rank_2024       = Column(Integer, default=0)    # 2024软科排名
    rank_type       = Column(String, default="")    # 综合/理工/文法
    city_level      = Column(String, default="")    # 一线/新一线/二线/三线
    admin_dept      = Column(String, default="")    # 主管部门（教育部/省政府）
    flagship_majors = Column(Text, default="")      # 王牌专业
    employment_quality = Column(Text, default="")   # 就业流向摘要
    satisfaction_score = Column(Float, default=0.0) # 院校综合满意度
    admission_website = Column(String, default="")  # 招生网址
    founded_year    = Column(Integer, default=0)    # 建校年份


class SubjectEvaluation(Base):
    """第四轮学科评估结果"""
    __tablename__ = "subject_evaluations"
    id            = Column(Integer, primary_key=True, index=True)
    school_name   = Column(String, index=True)
    school_code   = Column(String, index=True)
    subject_code  = Column(String)                           # 学科代码，如 0101
    subject_name  = Column(String, index=True)              # 学科名称，如 哲学
    grade         = Column(String)                           # A+/A/A-/B+/B/B-/C+/C/C-
    category      = Column(String)                           # 门类
    major_category = Column(String)                         # 专业大类

    __table_args__ = (
        Index("ix_subj_school_subject", "school_name", "subject_name"),
    )


class Major(Base):
    """院校专业信息（含选科要求）"""
    __tablename__ = "majors"
    id            = Column(Integer, primary_key=True, index=True)
    school_code   = Column(String, index=True)
    school_name   = Column(String, index=True)
    major_name    = Column(String, index=True)
    major_group   = Column(String, default="")              # 专业组
    subject_req   = Column(String, default="")              # 选科要求
    plan_count    = Column(Integer, default=0)              # 招生人数
    tuition       = Column(Integer, default=0)              # 学费（元/年）
    duration      = Column(String, default="4")             # 学制
    province      = Column(String, default="")              # 招生省份
    city          = Column(String, default="")              # 院校城市
    year          = Column(Integer, default=0)              # 招生年份
    batch         = Column(String, default="")              # 批次


class AdmissionRecord(Base):
    """历年专业录取记录（核心数据）"""
    __tablename__ = "admission_records"
    id            = Column(Integer, primary_key=True, index=True)
    school_code   = Column(String, index=True)
    school_name   = Column(String, index=True)
    major_name    = Column(String, index=True)
    major_group   = Column(String, default="")
    province      = Column(String, index=True)              # 招生省份
    year          = Column(Integer, index=True)
    batch         = Column(String, default="")              # 批次
    subject_req   = Column(String, default="")              # 选科要求
    min_score     = Column(Integer, default=0)              # 最低录取分
    min_rank      = Column(Integer, default=0)              # 最低录取位次
    admit_count   = Column(Integer, default=0)              # 录取人数
    school_province = Column(String, default="")            # 院校所在省
    school_nature = Column(String, default="")              # 公办/民办
    is_985        = Column(String, default="否")
    is_211        = Column(String, default="否")

    __table_args__ = (
        Index("ix_adm_school_major_year", "school_name", "major_name", "year", "province"),
    )


class RankTable(Base):
    """一分一段表"""
    __tablename__ = "rank_tables"
    id            = Column(Integer, primary_key=True, index=True)
    province      = Column(String, index=True)
    year          = Column(Integer, index=True)
    category      = Column(String, default="综合")          # 科类
    batch         = Column(String, default="本科批")
    score         = Column(Integer)                          # 分数
    count_this    = Column(Integer, default=0)              # 本段人数
    count_cum     = Column(Integer, default=0)              # 累计人数（即位次）
    rank_min      = Column(Integer, default=0)              # 排名区间最小值
    rank_max      = Column(Integer, default=0)              # 排名区间最大值

    __table_args__ = (
        Index("ix_rank_province_year_score", "province", "year", "score"),
    )


class MajorEmployment(Base):
    """专业就业信息 v2"""
    __tablename__ = "major_employment"
    id              = Column(Integer, primary_key=True, index=True)
    major_name      = Column(String, index=True)
    edu_level       = Column(String, default="本科")
    category_1      = Column(String, default="")
    category_2      = Column(String, default="")
    avg_salary      = Column(Integer, default=0)
    employment_rank = Column(String, default="")
    top_city        = Column(String, default="")
    top_industry    = Column(String, default="")
    job_directions  = Column(Text, default="")
    common_jobs     = Column(Text, default="")
    salary_by_exp   = Column(Text, default="")
    # ── 新增字段（Sprint 1.2） ──────────────────────────────────
    satisfaction    = Column(Float, default=0.0)    # 综合满意度（0-5）
    employment_rate = Column(Float, default=0.0)    # 就业率
    intro           = Column(Text, default="")      # 专业简介
    training_goal   = Column(Text, default="")      # 培养目标
    career_direction = Column(Text, default="")     # 就业方向（详细）
    industry_dist   = Column(Text, default="")      # 行业分布 JSON
    city_dist       = Column(Text, default="")      # 城市分布 JSON
    salary_trend    = Column(Text, default="")      # 薪资历年趋势 JSON
    gender_male     = Column(String, default="")    # 男生比例
    gender_female   = Column(String, default="")    # 女生比例
    major_code      = Column(String, default="")    # 国标专业代码


class NationalProgram(Base):
    """全国院校开设专业目录"""
    __tablename__ = "national_programs"
    id              = Column(Integer, primary_key=True, index=True)
    school_name     = Column(String, index=True)
    province        = Column(String, index=True)
    city            = Column(String, default="")
    major_name      = Column(String, index=True)
    major_category  = Column(String, default="")    # 专业大类（如"经济学类(本)"）

    __table_args__ = (
        Index("ix_np_school_major", "school_name", "major_name"),
    )


class ProvinceControlLine(Base):
    """全国各省历年批次控制线"""
    __tablename__ = "province_control_lines"
    id              = Column(Integer, primary_key=True, index=True)
    province        = Column(String, index=True)
    year            = Column(Integer, index=True)
    batch           = Column(String, default="")    # 本科一批/特殊类型等
    subject_type    = Column(String, default="")    # 首选历史/首选物理/理科/文科
    score           = Column(Integer, default=0)

    __table_args__ = (
        Index("ix_pcl_province_year", "province", "year", "subject_type"),
    )


class User(Base):
    """用户表"""
    __tablename__ = "users"
    id              = Column(Integer, primary_key=True, index=True)
    phone           = Column(String(11), unique=True, index=True, nullable=True)
    wechat_openid   = Column(String(64), unique=True, index=True, nullable=True)
    wechat_mini_openid = Column(String(64), unique=True, index=True, nullable=True)
    nickname        = Column(String(50), default="")
    province        = Column(String(10), default="")
    created_at      = Column(DateTime, default=datetime.datetime.utcnow)
    last_active_at  = Column(DateTime, default=datetime.datetime.utcnow)
    referral_code       = Column(String(8), unique=True, nullable=True)
    referred_by         = Column(Integer, nullable=True)
    is_paid             = Column(Integer, default=0)        # 0=未付费, 1=已付费
    subscription_type   = Column(String(20), default="")   # single_report / monthly_sub / quarterly_sub
    subscription_end_at = Column(DateTime, nullable=True)   # None=单次(永久); 订阅型到期时间


class Order(Base):
    """订单表"""
    __tablename__ = "orders"
    id              = Column(Integer, primary_key=True, index=True)
    order_no        = Column(String(32), unique=True, index=True, nullable=False)
    user_id         = Column(Integer, nullable=True)
    amount          = Column(Integer, nullable=False)        # 单位：分（1990 = ¥19.9）
    product_type    = Column(String(20), default="report_export")
    status          = Column(String(20), default="pending") # pending/paid/refunded
    pay_method      = Column(String(20), default="")        # wechat/alipay
    transaction_id  = Column(String(64), default="")        # 支付流水号
    pay_time        = Column(DateTime, nullable=True)
    created_at      = Column(DateTime, default=datetime.datetime.utcnow)
    ip              = Column(String(45), default="")
    rank_input      = Column(Integer, nullable=True)        # 用户查询位次
    province        = Column(String(10), default="")
    subject         = Column(String(50), default="")        # 选科，如"物理+化学"

    __table_args__ = (Index("ix_order_status_created", "status", "created_at"),)


class UserEvent(Base):
    """用户行为事件表"""
    __tablename__ = "user_events"
    id              = Column(Integer, primary_key=True, index=True)
    user_id         = Column(Integer, nullable=True)
    session_id      = Column(String(64), default="")
    event_type      = Column(String(50), index=True)
    event_data      = Column(Text, default="")              # JSON
    page            = Column(String(100), default="")
    province        = Column(String(10), default="")
    rank_input      = Column(Integer, nullable=True)
    created_at      = Column(DateTime, default=datetime.datetime.utcnow, index=True)
    ip              = Column(String(45), default="")
    user_agent      = Column(Text, default="")


class SchoolEmployment(Base):
    """学校级就业数据（来自各校年度报告 / 教育部平台 / 职友集）"""
    __tablename__ = "school_employment"
    id               = Column(Integer, primary_key=True, index=True)
    school_name      = Column(String, index=True)           # 学校名称（与 schools.name 对应）
    year             = Column(Integer, default=0)           # 报告年份，如 2024
    employment_rate  = Column(Float, default=0.0)           # 总就业率 0~1（0.95 = 95%）
    avg_salary       = Column(Integer, default=0)           # 平均月薪（元）
    top_employers    = Column(Text, default="")             # JSON: [{"name":"华为","count":120}, ...]
    top_industries   = Column(Text, default="")             # JSON: {"IT互联网": 0.35, "金融": 0.18}
    top_cities       = Column(Text, default="")             # JSON: {"北京": 0.42, "上海": 0.21}
    postgrad_rate    = Column(Float, default=0.0)           # 国内深造率 0~1
    overseas_rate    = Column(Float, default=0.0)           # 出国/出境率 0~1
    postgrad_schools = Column(Text, default="")             # 深造去向摘要（文本，如"清北复交占40%"）
    top_employer_tier = Column(String, default="")          # "头部"/"中等"/"一般"（综合评级）
    data_source      = Column(String, default="")           # "官网报告"/"edu_platform"/"职友集"
    report_url       = Column(Text, default="")             # 原始数据 URL

    __table_args__ = (
        Index("ix_se_school_year", "school_name", "year"),
    )


class SchoolReview(Base):
    """学生口碑数据（来自贴吧/搜狗微信/知乎）"""
    __tablename__ = "school_reviews"
    id               = Column(Integer, primary_key=True, index=True)
    school_name      = Column(String, index=True)
    source           = Column(String, default="")        # "贴吧" / "搜狗微信"
    positive_count   = Column(Integer, default=0)        # 正向信号命中次数
    negative_count   = Column(Integer, default=0)        # 负向信号命中次数
    review_count     = Column(Integer, default=0)        # 采样帖子数
    sentiment_score  = Column(Float, default=0.5)        # 0~1，0.5为中性
    sentiment_delta  = Column(Float, default=0.0)        # 相对同层次学校的偏差
    top_positive     = Column(Text, default="")          # 高频正向词（JSON列表）
    top_negative     = Column(Text, default="")          # 高频负向词（JSON列表）
    sample_quotes    = Column(Text, default="")          # 代表性原文摘要（JSON）
    updated_at       = Column(DateTime, default=datetime.datetime.utcnow)

    __table_args__ = (Index("ix_sr_school", "school_name"),)


class SmsCode(Base):
    """短信验证码表（替代内存存储，服务重启不丢失）"""
    __tablename__ = "sms_codes"
    id          = Column(Integer, primary_key=True, index=True)
    phone       = Column(String(11), index=True, nullable=False)
    code        = Column(String(6), nullable=False)
    expires_at  = Column(Float, nullable=False)   # Unix timestamp
    created_at  = Column(Float, nullable=False)   # Unix timestamp（用于频率限制）
    ip          = Column(String(45), default="")  # 发送方IP（用于IP限速）


class ReportLog(Base):
    """报告生成记录（每次生成PDF写入一条）"""
    __tablename__ = "report_logs"
    id          = Column(Integer, primary_key=True, index=True)
    report_id   = Column(String(16), unique=True, index=True, nullable=False)  # 唯一短ID
    province    = Column(String(20), default="")
    rank        = Column(Integer, default=0)
    user_id     = Column(Integer, nullable=True)
    created_at  = Column(DateTime, default=datetime.datetime.utcnow)
    scan_count  = Column(Integer, default=0)   # 二维码被扫次数


class ReportScan(Base):
    """报告二维码扫描记录（每次扫描写入一条）"""
    __tablename__ = "report_scans"
    id          = Column(Integer, primary_key=True, index=True)
    report_id   = Column(String(16), index=True, nullable=False)
    scanned_at  = Column(DateTime, default=datetime.datetime.utcnow, index=True)
    ip          = Column(String(50), default="")
    user_agent  = Column(String(500), default="")
    referer     = Column(String(500), default="")   # 从哪个平台扫过来


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    Base.metadata.create_all(bind=engine)
    print("✅ 数据库表结构初始化完成")
