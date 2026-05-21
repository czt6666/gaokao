import sys, os
sys.path.insert(0, os.path.dirname(__file__))

from database import SessionLocal, User, Order
import datetime
import random
import string


def generate_code():
    return "".join(random.choices(string.ascii_uppercase + string.digits, k=6))


def test_invite():
    db = SessionLocal()

    # 清理旧测试数据
    db.query(User).filter(User.phone.like("TEST%")).delete(synchronize_session=False)
    db.query(Order).filter(Order.order_no.like("TEST%")).delete(synchronize_session=False)
    db.commit()

    # 创建邀请人
    referrer = User(
        phone="TEST00000000",
        referral_code="TEST99",
        is_paid=1,
        subscription_end_at=datetime.datetime.utcnow() + datetime.timedelta(days=10),
        referral_reward_days=0,
    )
    db.add(referrer)
    db.commit()
    db.refresh(referrer)
    print(f"创建邀请人: id={referrer.id}, code={referrer.referral_code}")
    print(f"  初始会员到期: {referrer.subscription_end_at}")
    print(f"  初始奖励天数: {referrer.referral_reward_days}")
    print()

    from sqlalchemy import func as _func

    # 模拟创建 4 个被邀请人
    for i in range(1, 5):
        invited = User(
            phone=f"TEST{i:08d}",
            referred_by=referrer.id,
            referral_code=generate_code(),
        )
        db.add(invited)
        db.commit()
        print(f"步骤 {i}: 创建被邀请人 id={invited.id}")

        # 前 3 个人创建付费订单（第 4 个人只注册不付费）
        if i <= 3:
            order = Order(
                order_no=f"TESTORDER{i:04d}",
                user_id=invited.id,
                amount=1990,
                status="paid",
                ref_code=referrer.referral_code,
            )
            db.add(order)
            db.commit()
            print(f"  -> 创建付费订单")

        # 统计当前人数
        paid_count = (
            db.query(_func.count(Order.id))
            .filter(Order.ref_code == referrer.referral_code, Order.status == "paid")
            .scalar()
            or 0
        )
        reg_count = (
            db.query(_func.count(User.id))
            .filter(User.referred_by == referrer.id)
            .scalar()
            or 0
        )
        total = paid_count + reg_count
        print(f"  累计: {paid_count} 付费 + {reg_count} 注册 = {total} 人")

        # 触发里程碑奖励（复刻 payment.py 逻辑）
        if total >= 4 and referrer.referral_reward_days < 30:
            SEASON_END = datetime.datetime(2026, 8, 31, 23, 59, 59)
            referrer.subscription_end_at = min(
                referrer.subscription_end_at + datetime.timedelta(days=30),
                SEASON_END,
            )
            referrer.referral_reward_days = 30
            db.commit()
            print(f"  >>> 触发里程碑！邀请人 +30 天")
        print()

    db.refresh(referrer)
    print("=" * 40)
    print(f"最终结果:")
    print(f"  会员到期时间: {referrer.subscription_end_at}")
    print(f"  里程碑奖励天数: {referrer.referral_reward_days}")
    print("=" * 40)

    # 清理测试数据
    db.query(User).filter(User.phone.like("TEST%")).delete(synchronize_session=False)
    db.query(Order).filter(Order.order_no.like("TEST%")).delete(synchronize_session=False)
    db.commit()
    db.close()
    print("\n测试数据已自动清理")


if __name__ == "__main__":
    test_invite()
