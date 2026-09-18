#!/usr/bin/env python3
# SJ 메신저 앱 아이콘 생성기 — 의존성 0 (zlib+struct 로 PNG 직접 씀).
# 왜 스크립트인가: 아이콘을 바꿀 일이 생겼을 때 디자인 도구 없이 다시 뽑기 위해.
#   python3 make-icons.py
# 만드는 것: icon-192.png · icon-512.png · icon-512-maskable.png · apple-touch-icon-180.png
import os
import struct
import zlib

파랑 = (37, 99, 235)      # --primary #2563eb
흰색 = (255, 255, 255)
배경 = (248, 250, 252)    # 남는 여백이 생길 때(없지만) 대비

배율 = 3                   # 슈퍼샘플링 — 가장자리 계단 없애기
마스터 = 512 * 배율


def 둥근사각(x, y, 좌, 상, 우, 하, 반지름):
    if x < 좌 or x > 우 or y < 상 or y > 하:
        return False
    if 반지름 <= 0:
        return True
    # 네 귀퉁이 정사각형 안에 들어왔을 때만 원 거리를 본다. 나머지(십자 영역)는 전부 안쪽.
    if 좌 + 반지름 <= x <= 우 - 반지름:
        return True
    if 상 + 반지름 <= y <= 하 - 반지름:
        return True
    cx = 좌 + 반지름 if x < 좌 + 반지름 else 우 - 반지름
    cy = 상 + 반지름 if y < 상 + 반지름 else 하 - 반지름
    return (x - cx) ** 2 + (y - cy) ** 2 <= 반지름 ** 2


def 원(x, y, cx, cy, r):
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r


def 삼각(x, y, a, b, c):
    def 부호(p, q, r):
        return (p[0] - r[0]) * (q[1] - r[1]) - (q[0] - r[0]) * (p[1] - r[1])
    d1, d2, d3 = 부호((x, y), a, b), 부호((x, y), b, c), 부호((x, y), c, a)
    음 = (d1 < 0) or (d2 < 0) or (d3 < 0)
    양 = (d1 > 0) or (d2 > 0) or (d3 > 0)
    return not (음 and 양)


def 그리기(크기, 말풍선비율, 바탕둥글게):
    """한 장을 크기x크기 RGB 바이트로 그린다."""
    s = 크기
    화면 = bytearray(s * s * 3)
    바탕반지름 = s * 0.22 if 바탕둥글게 else 0
    b = s * 말풍선비율
    cx, cy = s / 2, s / 2
    좌, 우 = cx - b / 2, cx + b / 2
    상, 하 = cy - b * 0.40, cy + b * 0.26
    말반지름 = b * 0.22
    꼬리 = ((cx - b * 0.22, 하 - b * 0.02), (cx - b * 0.30, cy + b * 0.46), (cx + b * 0.02, 하 - b * 0.02))
    점y = (상 + 하) / 2
    점r = b * 0.072
    점들 = ((cx - b * 0.25, 점y), (cx, 점y), (cx + b * 0.25, 점y))

    for y in range(s):
        줄 = y * s * 3
        for x in range(s):
            if 바탕둥글게 and not 둥근사각(x, y, 0, 0, s - 1, s - 1, 바탕반지름):
                색 = 배경
            elif 둥근사각(x, y, 좌, 상, 우, 하, 말반지름) or 삼각(x, y, *꼬리):
                색 = 흰색
                for dx, dy in 점들:
                    if 원(x, y, dx, dy, 점r):
                        색 = 파랑
                        break
            else:
                색 = 파랑
            i = 줄 + x * 3
            화면[i], 화면[i + 1], 화면[i + 2] = 색
    return 화면


def 축소(원본, 원크기, 목표):
    """박스 필터 다운샘플 — 배율이 정수가 아니어도 된다."""
    결과 = bytearray(목표 * 목표 * 3)
    비 = 원크기 / 목표
    for y in range(목표):
        y0, y1 = int(y * 비), max(int(y * 비) + 1, int((y + 1) * 비))
        for x in range(목표):
            x0, x1 = int(x * 비), max(int(x * 비) + 1, int((x + 1) * 비))
            r = g = bl = n = 0
            for sy in range(y0, y1):
                기준 = sy * 원크기 * 3
                for sx in range(x0, x1):
                    i = 기준 + sx * 3
                    r += 원본[i]; g += 원본[i + 1]; bl += 원본[i + 2]; n += 1
            i = (y * 목표 + x) * 3
            결과[i], 결과[i + 1], 결과[i + 2] = r // n, g // n, bl // n
    return 결과


def png저장(경로, 크기, rgb):
    원시 = b''.join(b'\x00' + bytes(rgb[y * 크기 * 3:(y + 1) * 크기 * 3]) for y in range(크기))

    def 덩어리(종류, 내용):
        return (struct.pack('>I', len(내용)) + 종류 + 내용
                + struct.pack('>I', zlib.crc32(종류 + 내용) & 0xffffffff))

    머리 = struct.pack('>IIBBBBB', 크기, 크기, 8, 2, 0, 0, 0)  # 8bit truecolor
    with open(경로, 'wb') as f:
        f.write(b'\x89PNG\r\n\x1a\n'
                + 덩어리(b'IHDR', 머리)
                + 덩어리(b'IDAT', zlib.compress(원시, 9))
                + 덩어리(b'IEND', b''))


def main():
    여기 = os.path.dirname(os.path.abspath(__file__))
    일반 = 그리기(마스터, 0.66, True)
    for 크기, 이름 in ((512, 'icon-512.png'), (192, 'icon-192.png'), (180, 'apple-touch-icon-180.png')):
        png저장(os.path.join(여기, 이름), 크기, 축소(일반, 마스터, 크기))
        print('썼다', 이름)
    가림 = 그리기(마스터, 0.46, False)   # maskable: 안전영역(80%) 안에 들어가게 작게
    png저장(os.path.join(여기, 'icon-512-maskable.png'), 512, 축소(가림, 마스터, 512))
    print('썼다 icon-512-maskable.png')


if __name__ == '__main__':
    main()
