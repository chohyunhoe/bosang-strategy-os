#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""CLI: python run_pipeline.py <report.pdf> [out.json] [--password] [--target-dong] [--target-lot]"""
import argparse
import json
import os
import sys
sys.path.insert(0, "src")
from bso_parser import pipeline

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("pdf", help="감정평가서 PDF 경로")
    parser.add_argument("output", nargs="?", help="출력 JSON 경로")
    parser.add_argument("--password", default=os.environ.get("BSO_PDF_PASSWORD"),
                        help="암호화 PDF 비밀번호 (환경변수 BSO_PDF_PASSWORD)")
    parser.add_argument("--target-dong", help="대상토지 동")
    parser.add_argument("--target-lot", help="대상토지 지번")
    parser.add_argument("--target-serial", help="대상토지 일련번호")
    args = parser.parse_args()

    result = pipeline.to_json_dict(pipeline.run(
        args.pdf,
        password=args.password,
        target_dong=args.target_dong,
        target_lot=args.target_lot,
        target_serial=args.target_serial,
    ))
    s = json.dumps(result, ensure_ascii=False, indent=2)
    if args.output:
        open(args.output, "w", encoding="utf-8").write(s)
        print(f"written: {args.output}")
    else:
        print(s)

if __name__ == "__main__":
    main()
