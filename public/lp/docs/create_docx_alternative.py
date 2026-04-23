#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
要件定義書をDOCX形式に変換する代替スクリプト
python-docxが使えない環境用
"""

import os
import zipfile
import xml.etree.ElementTree as ET
from datetime import datetime

def create_minimal_docx(content_text, output_filename):
    """最小限のDOCXファイルを作成"""
    
    # 一時ディレクトリ作成
    temp_dir = "temp_docx"
    os.makedirs(temp_dir, exist_ok=True)
    os.makedirs(f"{temp_dir}/_rels", exist_ok=True)
    os.makedirs(f"{temp_dir}/word", exist_ok=True)
    os.makedirs(f"{temp_dir}/word/_rels", exist_ok=True)
    
    # [Content_Types].xml
    content_types = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
    <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
    <Default Extension="xml" ContentType="application/xml"/>
    <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>'''
    
    with open(f"{temp_dir}/[Content_Types].xml", "w", encoding="utf-8") as f:
        f.write(content_types)
    
    # _rels/.rels
    rels = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
    <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>'''
    
    with open(f"{temp_dir}/_rels/.rels", "w", encoding="utf-8") as f:
        f.write(rels)
    
    # word/document.xml
    document_start = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
    <w:body>'''
    
    document_end = '''    </w:body>
</w:document>'''
    
    # テキストを段落に変換
    paragraphs = content_text.split('\n')
    body_content = ""
    
    for para in paragraphs:
        if para.strip():
            # タイトルや見出しの判定
            if para.startswith('#'):
                # 見出しレベルに応じてスタイルを変更
                level = len(para.split()[0])
                clean_text = para.lstrip('#').strip()
                body_content += f'''
        <w:p>
            <w:pPr>
                <w:pStyle w:val="Heading{min(level, 3)}"/>
            </w:pPr>
            <w:r>
                <w:t>{clean_text}</w:t>
            </w:r>
        </w:p>'''
            else:
                body_content += f'''
        <w:p>
            <w:r>
                <w:t>{para}</w:t>
            </w:r>
        </w:p>'''
    
    document_xml = document_start + body_content + document_end
    
    with open(f"{temp_dir}/word/document.xml", "w", encoding="utf-8") as f:
        f.write(document_xml)
    
    # ZIPファイルとして圧縮
    with zipfile.ZipFile(output_filename, 'w', zipfile.ZIP_DEFLATED) as docx:
        for root, dirs, files in os.walk(temp_dir):
            for file in files:
                file_path = os.path.join(root, file)
                arcname = os.path.relpath(file_path, temp_dir)
                docx.write(file_path, arcname)
    
    # 一時ファイルを削除
    import shutil
    shutil.rmtree(temp_dir)
    
    print(f"DOCXファイルを作成しました: {output_filename}")

def convert_markdown_to_docx():
    """Markdownファイルを読み込んでDOCXに変換"""
    
    # Markdownファイルを読み込み
    md_file = "INTERCONNECT_要件定義書.md"
    if not os.path.exists(md_file):
        print(f"エラー: {md_file}が見つかりません")
        return
    
    with open(md_file, "r", encoding="utf-8") as f:
        content = f.read()
    
    # 簡易的なMarkdownからテキストへの変換
    # コードブロックを除去
    import re
    content = re.sub(r'```[^`]*```', '[コードブロック]', content, flags=re.DOTALL)
    content = re.sub(r'`([^`]+)`', r'\1', content)
    
    # リンクを変換
    content = re.sub(r'\[([^\]]+)\]\([^\)]+\)', r'\1', content)
    
    # 強調を変換
    content = re.sub(r'\*\*([^*]+)\*\*', r'\1', content)
    content = re.sub(r'\*([^*]+)\*', r'\1', content)
    
    # テーブルを簡易的に変換
    content = re.sub(r'\|', ' | ', content)
    
    # DOCXファイルを作成
    output_file = "INTERCONNECT_要件定義書.docx"
    create_minimal_docx(content, output_file)
    
    return output_file

if __name__ == "__main__":
    convert_markdown_to_docx()