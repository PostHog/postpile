import { useLessons } from '../api/lessons.ts';
import { LessonCard } from './LessonCard.tsx';

/** The topic's open lessons under its header. Nothing at all while there are none. */
export function TopicLessons(props: { topicId: string }) {
  const lessons = useLessons(props.topicId);
  if (lessons.error) {
    return <p className="mt-2.5 text-xs text-status-bad">Could not load the lessons: {lessons.error.message}</p>;
  }
  if (!lessons.data || lessons.data.length === 0) {
    return null;
  }
  return (
    <div className="mt-2.5 flex max-w-[680px] flex-col gap-2">
      {lessons.data.length > 1 && <span className="text-xs font-semibold text-ink">Remember for future assessments?</span>}
      {lessons.data.map((lesson) => (
        <LessonCard key={lesson.id} lesson={lesson} heading={lessons.data.length === 1} />
      ))}
    </div>
  );
}
