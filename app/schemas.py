from typing import List, Optional

from pydantic import BaseModel, Field


class InputField(BaseModel):
    name: str = Field(..., description="输入字段名")
    type: str = Field(default="string", description="string/number/list/object")
    description: str = Field(default="", description="字段说明")
    required: bool = Field(default=True, description="是否必填")


class AnalysisStep(BaseModel):
    order: int = Field(..., description="步骤顺序")
    title: str = Field(..., description="步骤名称")
    goal: str = Field(default="", description="本步骤要得出什么")
    method: str = Field(default="llm", description="llm 或 rule")
    prompt: Optional[str] = Field(default=None, description="给 LLM 的指令或规则说明")


class SkillConfig(BaseModel):
    id: str = Field(default="", description="Skill 唯一 ID")
    name: str = Field(..., description="Skill 名称")
    description: str = Field(..., description="Skill 描述")
    use_cases: List[str] = Field(default_factory=list, description="使用场景")
    input_schema: List[InputField] = Field(default_factory=list, description="输入数据定义")
    analysis_steps: List[AnalysisStep] = Field(default_factory=list, description="分析流程")
    agent_prompt: str = Field(..., description="Agent Prompt")
    output_template: str = Field(..., description="输出结果模板")
    version: str = Field(default="v1", description="版本")
    model: str = Field(default="", description="生成该 Skill 时使用的模型")
    created_at: str = Field(default="", description="创建时间")
    requirement: str = Field(default="", description="原始需求")
