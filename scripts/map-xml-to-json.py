import sys
import os
import re
import json

def process_file(file_path):
    if not os.path.exists(file_path):
        print(f"Файл не знайдено: {file_path}")
        return

    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # 1. З розділу RPs витягуємо інформацію про індекси сторінок
    rp_regex = re.compile(r'<RP [^>]*P="([^"]+)"')
    page_id_to_index = {}
    
    for match in rp_regex.finditer(content):
        parts = match.group(1).split('|')
        if len(parts) >= 3:
            # Третій елемент (індекс 2) є індексом сторінки
            try:
                page_id_to_index[parts[0]] = int(parts[2])
            except ValueError:
                pass
    
    # 2. Ітеруємося по тегах <Page PG="...">
    page_regex = re.compile(r'<Page PG="([^"]+)">([\s\S]*?)<\/Page>', re.IGNORECASE)
    fields = []
    
    for match in page_regex.finditer(content):
        pg_parts = match.group(1).split('|')
        page_id = pg_parts[0] # ID сторінки
        
        # Знаходимо індекс за допомогою зібраного словника
        page_index = page_id_to_index.get(page_id)
        
        inner_content = match.group(2)
        # 3. З кожного вкладеного тегу витягуємо атрибут VT
        vt_regex = re.compile(r'VT="([^"]+)"', re.IGNORECASE)
        
        for vt_match in vt_regex.finditer(inner_content):
            vt_parts = vt_match.group(1).split('|')
            if len(vt_parts) > 1:
                # fields.id = VT[1]
                field_id = vt_parts[1]
                
                # Координати зберігаються під індексом 2, наприклад "9087;6921;1745;285;"
                x = y = w = h = 0.0
                if len(vt_parts) > 2:
                    coords = vt_parts[2].split(';')
                    if len(coords) >= 4:
                        try:
                            x = float(coords[0])
                            y = float(coords[1])
                            w = float(coords[2])
                            h = float(coords[3])
                        except ValueError:
                            pass
                
                fields.append({
                    "id": field_id,
                    "name": field_id,  # fields.name = fields.id
                    "type": "text",    # default
                    "page": page_index, # fields.page = extracted from RPs
                    "x": x,
                    "y": y,
                    "w": w,
                    "h": h,
                    "value": {
                        "parsed": ""
                    }
                })
    
    result = {
        "schema": "pdf-mapper-web:v1",
        "fields": fields
    }
    
    # Формуємо результативний шлях
    script_dir = os.path.dirname(os.path.abspath(__file__))
    # Виходимо з папки scripts на корінь проєкту і йдемо в data/projects/nonsub/mappings
    out_dir = os.path.join(script_dir, '..', 'data', 'projects', 'nonsub', 'mappings')
    out_dir = os.path.normpath(out_dir)
    
    os.makedirs(out_dir, exist_ok=True)
    
    basename = os.path.splitext(os.path.basename(file_path))[0]
    out_path = os.path.join(out_dir, f"{basename}.json")
    
    # Записуємо JSON
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(result, f, indent=2, ensure_ascii=False)
        
    print(f"Успішно створено мапінг: {out_path}")
    print(f"Загальна кількість полів: {len(fields)}")

if __name__ == '__main__':
    args = sys.argv[1:]
    if len(args) > 0:
        for file_path in args:
            process_file(file_path)
    else:
        print("Вкажіть шлях до одного або декількох xml-файлів як аргументи.")
        print("Наприклад: python3 scripts/map-xml-to-json.py data/statereturns/2025/ID/IDPremPC.xml")
