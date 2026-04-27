"""
本地测试用：给 gaokao.db 塞一个测试用户 + 一笔已付费订单，
并打印 JWT token 和目标 URL，用于验证"我的订单 → 查看报告"流程。

用法（在 backend/ 目录下）：
    python -m scripts.seed_test_order

执行后：
  1. 把打印出的 AUTH_TOKEN 复制到浏览器 DevTools → Application → Local Storage
     key = auth_token, value = <token>
  2. 访问打印的 DASHBOARD_URL，应该能看到这笔"已购报告"
  3. 点"查看报告"，应直接进入解锁页（不再弹 PayModal）
  4. 测试完运行 python -m scripts.seed_test_order --clean 清理
"""
import sys
import time
import datetime
import argparse

# 允许脚本从 backend/ 根目录作为 CWD 运行
sys.path.insert(0, ".")

from database import SessionLocal, User, Order
from routers.auth import _make_token
from urllib.parse import quote

TEST_PHONE = "13800000001"
TEST_PROVINCE = "广东"
TEST_RANK = 50000
TEST_SUBJECT = "物理+化学"  # 故意带 "+" 复现 URL 编码 bug
TEST_ORDER_NO = "TEST_SEED_ORDER_0001"


def seed():
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.phone == TEST_PHONE).first()
        if not user:
            user = User(
                phone=TEST_PHONE,
                nickname="本地测试账户",
                province=TEST_PROVINCE,
                is_paid=1,
                created_at=datetime.datetime.utcnow(),
                last_active_at=datetime.datetime.utcnow(),
            )
            db.add(user)
            db.commit()
            db.refresh(user)
            print(f"[+] 创建测试用户 id={user.id} phone={TEST_PHONE}")
        else:
            print(f"[=] 复用已有测试用户 id={user.id} phone={TEST_PHONE}")

        order = db.query(Order).filter(Order.order_no == TEST_ORDER_NO).first()
        if not order:
            order = Order(
                order_no=TEST_ORDER_NO,
                user_id=user.id,
                amount=199,
                product_type="report_export",
                status="paid",
                pay_method="wechat",
                transaction_id="TEST_TX",
                pay_time=datetime.datetime.utcnow(),
                created_at=datetime.datetime.utcnow(),
                rank_input=TEST_RANK,
                province=TEST_PROVINCE,
                subject=TEST_SUBJECT,
            )
            db.add(order)
            db.commit()
            print(f"[+] 创建已付费订单 order_no={TEST_ORDER_NO}")
        else:
            print(f"[=] 复用已有订单 order_no={TEST_ORDER_NO}")

        token = _make_token(user.id, user.phone)

        dashboard_url = "http://localhost:3000/dashboard"
        results_url = (
            f"http://localhost:3000/results"
            f"?province={quote(TEST_PROVINCE)}"
            f"&rank={TEST_RANK}"
            f"&subject={quote(TEST_SUBJECT)}"
            f"&order_no={quote(TEST_ORDER_NO)}"
        )

        print("\n" + "=" * 70)
        print("AUTH_TOKEN（贴到浏览器 localStorage 的 auth_token 里）:")
        print(token)
        print("\nDASHBOARD_URL:", dashboard_url)
        print("RESULTS_URL :", results_url)
        print("=" * 70)
        print(
            "\n浏览器一次性注入（DevTools Console 里贴这行）:\n"
            f"  localStorage.setItem('auth_token', '{token}'); "
            f"location.href='{dashboard_url}'"
        )
    finally:
        db.close()


def clean():
    db = SessionLocal()
    try:
        o = db.query(Order).filter(Order.order_no == TEST_ORDER_NO).first()
        if o:
            db.delete(o)
        u = db.query(User).filter(User.phone == TEST_PHONE).first()
        if u:
            db.delete(u)
        db.commit()
        print("[-] 已清理测试用户和订单")
    finally:
        db.close()


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--clean", action="store_true", help="清理测试数据")
    args = ap.parse_args()
    if args.clean:
        clean()
    else:
        seed()
