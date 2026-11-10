<script setup lang="ts">
import { computed, ref } from "vue";
import { Check, ChevronDown, FileText, BookOpen, ListTree, CircleCheck, Circle } from "@lucide/vue";
import type { OutlineItem } from "../types";
const props = defineProps<{ items: OutlineItem[]; active: string; completed: string[] }>();
defineEmits<{ navigate: [title: string]; review: [] }>();
const tab = ref<"outline" | "requirements">("outline");
const folded = ref(false);
const chapters = computed(() => props.items.filter((item) => item.level === 1));
</script>

<template>
  <aside class="document-outline" aria-label="论文导航">
    <div class="project-switch">
      <span class="project-file"><FileText :size="18" /></span>
      <div><strong>我的毕业论文</strong><span>本科毕业论文 · 示例</span></div>
    </div>
    <div class="outline-tabs" role="tablist" aria-label="论文参考信息">
      <button role="tab" :aria-selected="tab === 'outline'" @click="tab = 'outline'">
        <ListTree :size="14" />目录
      </button>
      <button role="tab" :aria-selected="tab === 'requirements'" @click="tab = 'requirements'">
        <BookOpen :size="14" />要求
      </button>
    </div>
    <nav v-if="tab === 'outline'" class="chapter-list" aria-label="章节目录">
      <button
        v-for="item in items"
        :key="item.id"
        :class="{ active: active === item.title, subchapter: item.level > 1 }"
        @click="$emit('navigate', item.title)"
      >
        <span>{{ item.title }}</span
        ><Check v-if="completed.includes(item.title)" :size="13" aria-label="学生已确认完成" />
      </button>
    </nav>
    <section v-else class="requirements-view">
      <span class="section-eyebrow">示例模板</span>
      <h3>本科论文基本结构</h3>
      <p>绪论、需求分析、系统设计、实现与验证、总结与参考文献。</p>
      <h3>修订边界</h3>
      <p>数字、引用和公式保持原样；选区之外不修改。</p>
      <p class="source-note">正式学校规范尚未导入，示例样式不作为合规依据。</p>
    </section>
    <section class="project-progress">
      <button class="progress-heading" :aria-expanded="!folded" @click="folded = !folded">
        <span>毕设进度</span><ChevronDown :size="14" :class="{ folded }" />
      </button>
      <div v-if="!folded" class="stage-list">
        <div class="stage done">
          <CircleCheck :size="13" /><span>开题</span><small>示例已完成</small>
        </div>
        <div class="stage done"><CircleCheck :size="13" /><span>中期检查</span></div>
        <div class="stage current">
          <span class="current-dot"></span><span>论文写作</span><small>进行中</small>
        </div>
        <div class="stage"><Circle :size="13" /><span>定稿与答辩</span></div>
        <div class="chapter-completion">
          章节确认 <strong>{{ completed.length }} / {{ chapters.length }}</strong>
        </div>
      </div>
    </section>
    <div class="sidebar-footer">
      <span class="avatar-placeholder">同</span>
      <div><strong>同学，你好</strong><span>从当前这一段开始</span></div>
    </div>
  </aside>
</template>
