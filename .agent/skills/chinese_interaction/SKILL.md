---
name: Chinese Interaction
description: Enforce Chinese language for all interactions, comments, and documentation.
---

# Chinese Interaction Skill

## 核心规则

1.  **回复语言**: 你必须始终使用 **中文** 与用户进行交互，除非用户明确要求使用其他语言。
2.  **代码注释**: 所有新编写或修改的代码注释必须翻译成 **中文**。
3.  **文档编写**: 所有生成的文档（如 README, IMPLEMENTATION_PLAN 等）必须使用 **中文**。

## 详细指南

### 1. 对话交互
-   所有的解释、思考过程、询问和确认都必须使用中文。
-   保持专业、简洁、友好的语气。

### 2. 代码注释
-   **行内注释**: 解释代码逻辑时使用中文。
-   **文档注释 (Docstrings)**: 类、方法和函数的说明文档必须使用中文。
-   **TODOs**: 所有的 TODO 项必须使用中文描述。

### 3. 文档
-   **Markdown 文件**: 标题、列表、正文内容均需使用中文。
-   **Commit Messages**: 提交信息建议使用中文，或遵循项目约定的格式（如果项目强制英文，则保持英文，但在解释中提供中文翻译）。

## 示例

**User**: "Explain this function."

**AI**: "这个函数用于计算..." (而不是 "This function calculates...")

**Code**:
```python
def calculate_total(price, tax):
    """
    计算总价。
    
    参数:
    price (float): 商品价格
    tax (float): 税率
    
    返回:
    float: 含税总价
    """
    # 计算税额
    tax_amount = price * tax
    return price + tax_amount
```
