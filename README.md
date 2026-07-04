# sejong-platform-v2
세종기술 통합 플랫폼 - 전사 모놀리식 시스템

## main이 잘못 반영됐을 때 복구하는 법

`main`에 누군가 push할 때마다(나 자신 포함, 동료들도 마찬가지) GitHub Actions가
push 직전 상태를 `backup/YYYYMMDD-HHMMSS-<커밋SHA7자리>` 형태의 태그로 자동 저장한다.
(`.github/workflows/backup-before-main-push.yml`, 최근 30개까지 보관)

병합 실수 등으로 main이 옛 버전으로 되돌아가거나 코드가 깨졌을 때:

```bash
# 1. 백업 태그 목록 확인 (최신순으로 보려면 tail)
git fetch --tags
git tag -l "backup/*" | sort

# 2. 문제가 생기기 직전 태그를 골라 그 시점 파일로 되돌리고, 새 커밋으로 남긴다
git checkout backup/20260703-153000-abc1234 -- .
git commit -m "fix: main 잘못 반영된 부분을 backup 태그 기준으로 복구"
git push origin main
```

이 저장소는 여러 명이 병행 커밋하므로 **`git push --force`(강제 푸시)는 절대 사용하지 않는다.** 남의 커밋을 지울 수 있기 때문에, 복구는 항상 "옛 태그의 파일 내용을 가져와 새 커밋을 쌓는" 방식(2번)으로만 한다.
