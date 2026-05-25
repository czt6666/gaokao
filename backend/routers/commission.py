"""佣金与提现路由 — /api/commission/*"""
from fastapi import APIRouter, HTTPException, Depends, Header
from sqlalchemy.orm import Session
from sqlalchemy import desc
import datetime
from typing import Optional

from database import get_db, User, CommissionRecord, WithdrawalRecord
from routers.auth import _verify_token

router = APIRouter(prefix="/api/commission", tags=["commission"])


def _get_current_user(authorization: str = Header(""), db: Session = Depends(get_db)) -> User:
    token = authorization.replace("Bearer ", "") if authorization.startswith("Bearer ") else authorization
    if not token:
        raise HTTPException(status_code=401, detail="缺少登录凭证")
    payload = _verify_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="无效的登录凭证")
    user = db.query(User).filter(User.id == payload.get("uid")).first()
    if not user:
        raise HTTPException(status_code=401, detail="用户不存在")
    return user


def _thaw_commissions(db: Session, user_id: int):
    """Lazy 解冻：将已过冻结期的佣金从 pending 转入 balance"""
    now = datetime.datetime.utcnow()
    frozen = db.query(CommissionRecord).filter(
        CommissionRecord.user_id == user_id,
        CommissionRecord.status == "frozen",
        CommissionRecord.freeze_until <= now
    ).all()
    if not frozen:
        return
    total = sum(r.amount_fen for r in frozen)
    user = db.query(User).filter(User.id == user_id).first()
    if user and total > 0:
        user.pending_fen = max(0, user.pending_fen - total)
        user.balance_fen += total
        for r in frozen:
            r.status = "available"
        db.commit()


@router.get("/me")
def commission_me(db: Session = Depends(get_db), user: User = Depends(_get_current_user)):
    _thaw_commissions(db, user.id)
    records = db.query(CommissionRecord).filter(
        CommissionRecord.user_id == user.id
    ).order_by(desc(CommissionRecord.created_at)).limit(50).all()
    return {
        "balance_fen": user.balance_fen,
        "pending_fen": user.pending_fen,
        "total_earned_fen": user.total_earned_fen,
        "balance_yuan": round(user.balance_fen / 100, 2),
        "pending_yuan": round(user.pending_fen / 100, 2),
        "total_earned_yuan": round(user.total_earned_fen / 100, 2),
        "records": [
            {
                "id": r.id,
                "order_no": r.order_no,
                "amount_fen": r.amount_fen,
                "amount_yuan": round(r.amount_fen / 100, 2),
                "status": r.status,
                "freeze_until": r.freeze_until.isoformat() if r.freeze_until else None,
                "created_at": r.created_at.isoformat() if r.created_at else None,
            }
            for r in records
        ],
    }


@router.post("/withdraw")
def commission_withdraw(
    amount_fen: int,
    db: Session = Depends(get_db),
    user: User = Depends(_get_current_user),
):
    _thaw_commissions(db, user.id)
    MIN_WITHDRAW = 10000  # 100元 = 10000分
    if amount_fen < MIN_WITHDRAW:
        raise HTTPException(status_code=400, detail=f"提现金额不得低于 {MIN_WITHDRAW // 100} 元")
    if user.balance_fen < amount_fen:
        raise HTTPException(status_code=400, detail="可提现余额不足")

    user.balance_fen -= amount_fen
    db.add(WithdrawalRecord(
        user_id=user.id,
        amount_fen=amount_fen,
        status="pending",
    ))
    db.commit()
    return {"ok": True, "amount_fen": amount_fen, "balance_fen": user.balance_fen}


@router.get("/withdrawals")
def commission_withdrawals(
    limit: int = 20,
    offset: int = 0,
    db: Session = Depends(get_db),
    user: User = Depends(_get_current_user),
):
    rows = db.query(WithdrawalRecord).filter(
        WithdrawalRecord.user_id == user.id
    ).order_by(desc(WithdrawalRecord.created_at)).offset(offset).limit(limit).all()
    total = db.query(WithdrawalRecord).filter(WithdrawalRecord.user_id == user.id).count()
    return {
        "total": total,
        "items": [
            {
                "id": r.id,
                "amount_fen": r.amount_fen,
                "amount_yuan": round(r.amount_fen / 100, 2),
                "status": r.status,
                "admin_note": r.admin_note,
                "created_at": r.created_at.isoformat() if r.created_at else None,
                "processed_at": r.processed_at.isoformat() if r.processed_at else None,
            }
            for r in rows
        ],
    }
