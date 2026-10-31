"""Database models. SQLite locally, Postgres (Neon) when DATABASE_URL is set."""
from datetime import datetime, timezone

from sqlalchemy import (JSON, Boolean, DateTime, Float, ForeignKey, Integer,
                        String, Text, create_engine)
from sqlalchemy.orm import (DeclarativeBase, Mapped, mapped_column,
                            relationship, sessionmaker)

from . import config

connect_args = {"check_same_thread": False} if config.DATABASE_URL.startswith("sqlite") else {}
engine = create_engine(config.DATABASE_URL, connect_args=connect_args, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class Base(DeclarativeBase):
    pass


class Video(Base):
    __tablename__ = "videos"
    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(300))
    filename: Mapped[str] = mapped_column(String(300))
    has_video: Mapped[bool] = mapped_column(Boolean, default=True)
    duration_s: Mapped[float] = mapped_column(Float, default=0)
    language: Mapped[str] = mapped_column(String(40), default="")
    mock: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    segments: Mapped[list["Segment"]] = relationship(
        back_populates="video", order_by="Segment.idx", cascade="all, delete-orphan")


class Segment(Base):
    __tablename__ = "segments"
    id: Mapped[int] = mapped_column(primary_key=True)
    video_id: Mapped[int] = mapped_column(ForeignKey("videos.id"))
    idx: Mapped[int] = mapped_column(Integer)
    start_s: Mapped[float] = mapped_column(Float)
    end_s: Mapped[float] = mapped_column(Float)
    text: Mapped[str] = mapped_column(Text)
    video: Mapped[Video] = relationship(back_populates="segments")


class ClipRun(Base):
    """One ranking pass over a video, by the blank or the learned brain."""
    __tablename__ = "clip_runs"
    id: Mapped[int] = mapped_column(primary_key=True)
    video_id: Mapped[int] = mapped_column(ForeignKey("videos.id"))
    brain: Mapped[str] = mapped_column(String(10))            # blank | learned
    learning_note: Mapped[str] = mapped_column(Text, default="")
    rule_ids: Mapped[list] = mapped_column(JSON, default=list)
    insight_ids: Mapped[list] = mapped_column(JSON, default=list)
    mock: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)


class Clip(Base):
    __tablename__ = "clips"
    id: Mapped[int] = mapped_column(primary_key=True)
    run_id: Mapped[int] = mapped_column(ForeignKey("clip_runs.id"))
    video_id: Mapped[int] = mapped_column(ForeignKey("videos.id"))
    status: Mapped[str] = mapped_column(String(10))           # picked | rejected
    rank: Mapped[int] = mapped_column(Integer, default=0)
    start_seg: Mapped[int] = mapped_column(Integer)
    end_seg: Mapped[int] = mapped_column(Integer)
    start_s: Mapped[float] = mapped_column(Float)
    end_s: Mapped[float] = mapped_column(Float)
    title: Mapped[str] = mapped_column(String(300), default="")
    score: Mapped[float] = mapped_column(Float, default=0)
    scores: Mapped[dict] = mapped_column(JSON, default=dict)
    reasons: Mapped[list] = mapped_column(JSON, default=list)
    editor_note: Mapped[str] = mapped_column(Text, default="")
    hook_line: Mapped[str] = mapped_column(Text, default="")
    why: Mapped[str] = mapped_column(Text, default="")        # for rejected moments


class Post(Base):
    __tablename__ = "posts"
    id: Mapped[int] = mapped_column(primary_key=True)
    clip_id: Mapped[int | None] = mapped_column(ForeignKey("clips.id"), nullable=True)
    batch: Mapped[int] = mapped_column(Integer, default=1)
    platform: Mapped[str] = mapped_column(String(20))         # linkedin | x_thread | reels_caption | shorts_title
    draft_text: Mapped[str] = mapped_column(Text, default="")
    edited_text: Mapped[str] = mapped_column(Text, default="")
    hook_style: Mapped[str] = mapped_column(String(30), default="")
    applied_rules: Mapped[list] = mapped_column(JSON, default=list)
    scheduled_for: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    published_url: Mapped[str] = mapped_column(String(500), default="")
    published_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    impressions: Mapped[int] = mapped_column(Integer, default=0)
    reactions: Mapped[int] = mapped_column(Integer, default=0)
    comments: Mapped[int] = mapped_column(Integer, default=0)
    reposts: Mapped[int] = mapped_column(Integer, default=0)
    is_external: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)

    @property
    def text(self) -> str:
        return self.edited_text or self.draft_text


class VoiceRule(Base):
    __tablename__ = "voice_rules"
    id: Mapped[int] = mapped_column(primary_key=True)
    rule: Mapped[str] = mapped_column(Text)
    before_example: Mapped[str] = mapped_column(Text, default="")
    after_example: Mapped[str] = mapped_column(Text, default="")
    source_post_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    origin: Mapped[str] = mapped_column(String(20), default="edit")   # edit | describe
    confidence: Mapped[float] = mapped_column(Float, default=0.7)
    reinforced: Mapped[int] = mapped_column(Integer, default=0)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)


class Insight(Base):
    __tablename__ = "insights"
    id: Mapped[int] = mapped_column(primary_key=True)
    finding: Mapped[str] = mapped_column(Text)
    evidence: Mapped[str] = mapped_column(Text, default="")
    effect: Mapped[str] = mapped_column(Text, default="")
    strength: Mapped[str] = mapped_column(String(20), default="early")
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)


class Trace(Base):
    __tablename__ = "trace"
    id: Mapped[int] = mapped_column(primary_key=True)
    step: Mapped[str] = mapped_column(String(60))
    model: Mapped[str] = mapped_column(String(120), default="")
    input_summary: Mapped[str] = mapped_column(Text, default="")
    output_json: Mapped[str] = mapped_column(Text, default="")
    ms: Mapped[int] = mapped_column(Integer, default=0)
    mock: Mapped[bool] = mapped_column(Boolean, default=False)
    ok: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)


class VoiceLog(Base):
    __tablename__ = "voice_log"
    id: Mapped[int] = mapped_column(primary_key=True)
    who: Mapped[str] = mapped_column(String(80), default="")
    text: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)


def init_db() -> None:
    Base.metadata.create_all(engine)
