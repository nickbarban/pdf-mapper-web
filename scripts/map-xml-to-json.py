import sys
import os
import re
import json
from datetime import datetime
import uuid

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
                # Add 1 because pdfjs and the UI expect 1-based page numbers
                page_id_to_index[parts[0]] = int(parts[2]) + 1
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
        # 3. З кожного вкладеного тегу витягуємо назву тегу та атрибут VT
        vt_regex = re.compile(r'<(NT|TT|CT)[^>]*VT="([^"]+)"', re.IGNORECASE)
        
        for vt_match in vt_regex.finditer(inner_content):
            tag_name = vt_match.group(1).upper()
            vt_value = vt_match.group(2)
            
            vt_parts = vt_value.split('|')
            if len(vt_parts) > 1:
                # fields.id = VT[1]
                field_id = vt_parts[1]
                
                # Визначаємо тип поля на основі тегу
                field_type = "text"
                if tag_name == "NT":
                    field_type = "numeric"
                elif tag_name == "TT":
                    field_type = "text"
                elif tag_name == "CT":
                    field_type = "checkbox"
                
                # Координати зберігаються під індексом 2, наприклад "9087;6921;1745;285;"
                # Виміри у TWIPS (1/20 пункта) та вказані від правого нижнього кута.
                # Трансформуємо їх у стандартні координати PDF (від лівого верхнього кута)
                PAGE_WIDTH_PT = 612.0  # 8.5 дюймів
                PAGE_HEIGHT_PT = 792.0 # 11 дюймів
                
                x = y = w = h = 0.0
                if len(vt_parts) > 2:
                    coords = vt_parts[2].split(';')
                    if len(coords) >= 4:
                        try:
                            # Спочатку переводимо з TWIPS у пункти
                            w_pt = float(coords[2]) / 20.0
                            h_pt = float(coords[3]) / 20.0
                            x_pt = float(coords[0]) / 20.0
                            y_pt = float(coords[1]) / 20.0
                            
                            # Перераховуємо початок координат (Bottom-Right -> Top-Left)
                            # x = PAGE_WIDTH_PT - x_pt - w_pt
                            # y = PAGE_HEIGHT_PT - y_pt - h_pt
                            # w = w_pt
                            # h = h_pt
                            x = x_pt
                            y = y_pt
                            w = w_pt
                            h = h_pt
                        except ValueError:
                            pass
                
                fields.append({
                    "id": str(uuid.uuid4()),
                    "name": field_id,  # fields.name = fields.id
                    "type": field_type,
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
        "schema": "pdf-mapper-web:v2",
        "fields": fields
    }
    
    # Формуємо результативний шлях
    script_dir = os.path.dirname(os.path.abspath(__file__))
    # Виходимо з папки scripts на корінь проєкту і йдемо в data/projects/nonsub/mappings
    out_dir = os.path.join(script_dir, '..', 'data', 'projects', 'nonsub', 'mappings')
    out_dir = os.path.normpath(out_dir)
    
    os.makedirs(out_dir, exist_ok=True)
    
    basename = os.path.splitext(os.path.basename(file_path))[0]
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    out_path = os.path.join(out_dir, f"{basename}_{timestamp}.json")
    
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
