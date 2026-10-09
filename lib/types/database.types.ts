export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      body_metrics: {
        Row: {
          body_fat_pct: number | null
          created_at: string
          id: string
          notes: string | null
          recorded_at: string
          user_id: string
          weight_kg: number | null
        }
        Insert: {
          body_fat_pct?: number | null
          created_at?: string
          id?: string
          notes?: string | null
          recorded_at?: string
          user_id: string
          weight_kg?: number | null
        }
        Update: {
          body_fat_pct?: number | null
          created_at?: string
          id?: string
          notes?: string | null
          recorded_at?: string
          user_id?: string
          weight_kg?: number | null
        }
        Relationships: []
      }
      cycle_days: {
        Row: {
          day_index: number
          id: string
          routine_id: string | null
          training_cycle_id: string
        }
        Insert: {
          day_index: number
          id?: string
          routine_id?: string | null
          training_cycle_id: string
        }
        Update: {
          day_index?: number
          id?: string
          routine_id?: string | null
          training_cycle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cycle_days_routine_id_fkey"
            columns: ["routine_id"]
            isOneToOne: false
            referencedRelation: "routines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cycle_days_training_cycle_id_fkey"
            columns: ["training_cycle_id"]
            isOneToOne: false
            referencedRelation: "training_cycles"
            referencedColumns: ["id"]
          },
        ]
      }
      day_notes: {
        Row: {
          note: string
          note_date: string
          updated_at: string
          user_id: string
        }
        Insert: {
          note: string
          note_date: string
          updated_at?: string
          user_id: string
        }
        Update: {
          note?: string
          note_date?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      exercises: {
        Row: {
          created_at: string
          created_by: string | null
          embedding: string | null
          embedding_text: string | null
          equipment: string | null
          id: string
          is_custom: boolean
          joint_load: Json | null
          log_type: string
          muscle_group: string
          name: string
          name_zh_tw: string | null
          primary_muscles: string[]
          secondary_muscles: string[]
          stability_demand: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          embedding?: string | null
          embedding_text?: string | null
          equipment?: string | null
          id?: string
          is_custom?: boolean
          joint_load?: Json | null
          log_type?: string
          muscle_group: string
          name: string
          name_zh_tw?: string | null
          primary_muscles?: string[]
          secondary_muscles?: string[]
          stability_demand?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          embedding?: string | null
          embedding_text?: string | null
          equipment?: string | null
          id?: string
          is_custom?: boolean
          joint_load?: Json | null
          log_type?: string
          muscle_group?: string
          name?: string
          name_zh_tw?: string | null
          primary_muscles?: string[]
          secondary_muscles?: string[]
          stability_demand?: string | null
        }
        Relationships: []
      }
      period_notes: {
        Row: {
          note: string
          period_start: string
          updated_at: string
          user_id: string
        }
        Insert: {
          note: string
          period_start: string
          updated_at?: string
          user_id: string
        }
        Update: {
          note?: string
          period_start?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      period_reports: {
        Row: {
          completed_at: string | null
          context_summary: string | null
          created_at: string
          error_message: string | null
          id: string
          pdf_status: string
          period_start: string
          recommendation: Json | null
          status: string
          user_id: string
          user_note: string | null
        }
        Insert: {
          completed_at?: string | null
          context_summary?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          pdf_status?: string
          period_start: string
          recommendation?: Json | null
          status?: string
          user_id: string
          user_note?: string | null
        }
        Update: {
          completed_at?: string | null
          context_summary?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          pdf_status?: string
          period_start?: string
          recommendation?: Json | null
          status?: string
          user_id?: string
          user_note?: string | null
        }
        Relationships: []
      }
      ronnie_conversations: {
        Row: {
          conversation_date: string
          display: Json
          messages: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          conversation_date: string
          display?: Json
          messages?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          conversation_date?: string
          display?: Json
          messages?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      ronnie_pending_actions: {
        Row: {
          action: Json
          created_at: string
          expires_at: string
          id: string
          resolved_at: string | null
          status: string
          user_id: string
        }
        Insert: {
          action: Json
          created_at?: string
          expires_at: string
          id?: string
          resolved_at?: string | null
          status?: string
          user_id: string
        }
        Update: {
          action?: Json
          created_at?: string
          expires_at?: string
          id?: string
          resolved_at?: string | null
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      routine_exercises: {
        Row: {
          created_at: string
          exercise_id: string
          id: string
          order_index: number
          routine_id: string
          target_reps: number | null
          target_sets: number | null
        }
        Insert: {
          created_at?: string
          exercise_id: string
          id?: string
          order_index: number
          routine_id: string
          target_reps?: number | null
          target_sets?: number | null
        }
        Update: {
          created_at?: string
          exercise_id?: string
          id?: string
          order_index?: number
          routine_id?: string
          target_reps?: number | null
          target_sets?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "routine_exercises_exercise_id_fkey"
            columns: ["exercise_id"]
            isOneToOne: false
            referencedRelation: "exercises"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "routine_exercises_routine_id_fkey"
            columns: ["routine_id"]
            isOneToOne: false
            referencedRelation: "routines"
            referencedColumns: ["id"]
          },
        ]
      }
      routines: {
        Row: {
          created_at: string
          id: string
          name: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          user_id?: string
        }
        Relationships: []
      }
      training_cycles: {
        Row: {
          created_at: string
          cycle_length: number
          id: string
          start_date: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          cycle_length: number
          id?: string
          start_date: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          cycle_length?: number
          id?: string
          start_date?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_profiles: {
        Row: {
          created_at: string
          date_of_birth: string | null
          display_name: string | null
          height_cm: number | null
          height_updated_at: string | null
          language: string
          onboarding_completed: boolean
          sex: string | null
          timezone: string
          training_goal: string | null
          updated_at: string
          user_id: string
          weight_unit: string
        }
        Insert: {
          created_at?: string
          date_of_birth?: string | null
          display_name?: string | null
          height_cm?: number | null
          height_updated_at?: string | null
          language?: string
          onboarding_completed?: boolean
          sex?: string | null
          timezone?: string
          training_goal?: string | null
          updated_at?: string
          user_id: string
          weight_unit?: string
        }
        Update: {
          created_at?: string
          date_of_birth?: string | null
          display_name?: string | null
          height_cm?: number | null
          height_updated_at?: string | null
          language?: string
          onboarding_completed?: boolean
          sex?: string | null
          timezone?: string
          training_goal?: string | null
          updated_at?: string
          user_id?: string
          weight_unit?: string
        }
        Relationships: []
      }
      workout_planned_exercises: {
        Row: {
          created_at: string
          exercise_id: string
          id: string
          user_id: string
          workout_id: string
        }
        Insert: {
          created_at?: string
          exercise_id: string
          id?: string
          user_id: string
          workout_id: string
        }
        Update: {
          created_at?: string
          exercise_id?: string
          id?: string
          user_id?: string
          workout_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workout_planned_exercises_exercise_id_fkey"
            columns: ["exercise_id"]
            isOneToOne: false
            referencedRelation: "exercises"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workout_planned_exercises_workout_id_fkey"
            columns: ["workout_id"]
            isOneToOne: false
            referencedRelation: "workouts"
            referencedColumns: ["id"]
          },
        ]
      }
      workout_sets: {
        Row: {
          created_at: string
          exercise_id: string
          id: string
          reps: number
          set_number: number
          user_id: string
          weight_kg: number
          workout_id: string
        }
        Insert: {
          created_at?: string
          exercise_id: string
          id?: string
          reps: number
          set_number: number
          user_id: string
          weight_kg: number
          workout_id: string
        }
        Update: {
          created_at?: string
          exercise_id?: string
          id?: string
          reps?: number
          set_number?: number
          user_id?: string
          weight_kg?: number
          workout_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workout_sets_exercise_id_fkey"
            columns: ["exercise_id"]
            isOneToOne: false
            referencedRelation: "exercises"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workout_sets_workout_id_fkey"
            columns: ["workout_id"]
            isOneToOne: false
            referencedRelation: "workouts"
            referencedColumns: ["id"]
          },
        ]
      }
      workouts: {
        Row: {
          created_at: string
          id: string
          notes: string | null
          performed_at: string
          routine_id: string | null
          title: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          notes?: string | null
          performed_at?: string
          routine_id?: string | null
          title?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          notes?: string | null
          performed_at?: string
          routine_id?: string | null
          title?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workouts_routine_id_fkey"
            columns: ["routine_id"]
            isOneToOne: false
            referencedRelation: "routines"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      match_exercises: {
        Args: {
          p_count?: number
          p_embedding: string
          p_muscle_group?: string
        }
        Returns: {
          id: string
          similarity: number
        }[]
      }
      append_ronnie_conversation: {
        Args: {
          p_date: string
          p_display: Json
          p_messages: Json
        }
        Returns: undefined
      }
      resolve_ronnie_action: {
        Args: {
          p_action_id: string
          p_decision: string
        }
        Returns: Json
      }
      get_period_training_summary: {
        Args: {
          p_period_end: string
          p_period_start: string
          p_user_id: string
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
