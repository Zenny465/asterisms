"""
stars.jsonをつくるためのファイルです。
あらかじめpip install astroquery pandasを実行しておいてください。
"""

from astroquery.vizier import Vizier
import pandas as pd
import json

Vizier.ROW_LIMIT = -1  # 全データ取得
Vizier.columns = ["HIP", "RAICRS", "DEICRS", "Vmag"]
viz = Vizier(columns=Vizier.columns, column_filters={"Vmag": "<=5"}, row_limit=-1)
catalog = viz.get_catalogs("I/239/hip_main")[0]

df = catalog.to_pandas().dropna(subset=["RAICRS","DEICRS","Vmag"])
df["name"] = df["HIP"].apply(lambda x: f"HIP {x}")

records = df.rename(columns={"RAICRS":"ra","DEICRS":"dec","Vmag":"mag"})[
    ["name","ra","dec","mag"]
].to_dict(orient="records")

with open("stars.json", "w") as f:
    json.dump(records, f, indent=2)

print(f"Generated {len(records)} entries.")

