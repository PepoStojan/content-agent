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
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
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
  public: {
    Tables: {
      audit_log: {
        Row: {
          action: string
          actor_id: string | null
          after: Json | null
          before: Json | null
          created_at: string
          entity_id: string | null
          entity_type: string
          id: string
          project_id: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          after?: Json | null
          before?: Json | null
          created_at?: string
          entity_id?: string | null
          entity_type: string
          id?: string
          project_id?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          after?: Json | null
          before?: Json | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          id?: string
          project_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      blueprint_nodes: {
        Row: {
          blueprint_version_id: string
          created_at: string
          entities: Json
          evidence_requirement: string | null
          goal: string | null
          id: string
          internal_link_targets: Json
          level: number
          parent_id: string | null
          position: number
          research_support: string | null
          target_word_count: number | null
          title: string
          unique_contribution: string | null
          writing_notes: string | null
        }
        Insert: {
          blueprint_version_id: string
          created_at?: string
          entities?: Json
          evidence_requirement?: string | null
          goal?: string | null
          id?: string
          internal_link_targets?: Json
          level: number
          parent_id?: string | null
          position: number
          research_support?: string | null
          target_word_count?: number | null
          title: string
          unique_contribution?: string | null
          writing_notes?: string | null
        }
        Update: {
          blueprint_version_id?: string
          created_at?: string
          entities?: Json
          evidence_requirement?: string | null
          goal?: string | null
          id?: string
          internal_link_targets?: Json
          level?: number
          parent_id?: string | null
          position?: number
          research_support?: string | null
          target_word_count?: number | null
          title?: string
          unique_contribution?: string | null
          writing_notes?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "blueprint_nodes_blueprint_version_id_fkey"
            columns: ["blueprint_version_id"]
            isOneToOne: false
            referencedRelation: "blueprint_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "blueprint_nodes_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "blueprint_nodes"
            referencedColumns: ["id"]
          },
        ]
      }
      blueprint_versions: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          brief_version_id: string
          content_blueprint_id: string
          created_at: string
          created_by: string | null
          generated_at: string | null
          generation_run_id: string | null
          id: string
          model_id: string | null
          project_id: string
          prompt_version: string | null
          status: Database["public"]["Enums"]["artifact_version_status"]
          version: number
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          brief_version_id: string
          content_blueprint_id: string
          created_at?: string
          created_by?: string | null
          generated_at?: string | null
          generation_run_id?: string | null
          id?: string
          model_id?: string | null
          project_id: string
          prompt_version?: string | null
          status?: Database["public"]["Enums"]["artifact_version_status"]
          version: number
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          brief_version_id?: string
          content_blueprint_id?: string
          created_at?: string
          created_by?: string | null
          generated_at?: string | null
          generation_run_id?: string | null
          id?: string
          model_id?: string | null
          project_id?: string
          prompt_version?: string | null
          status?: Database["public"]["Enums"]["artifact_version_status"]
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "blueprint_versions_brief_version_id_fkey"
            columns: ["brief_version_id"]
            isOneToOne: false
            referencedRelation: "brief_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "blueprint_versions_content_blueprint_id_fkey"
            columns: ["content_blueprint_id"]
            isOneToOne: false
            referencedRelation: "content_blueprints"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "blueprint_versions_generation_run_id_fkey"
            columns: ["generation_run_id"]
            isOneToOne: false
            referencedRelation: "generation_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "blueprint_versions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      brand_profiles: {
        Row: {
          created_at: string
          created_by: string | null
          em_dash_forbidden: boolean
          forbidden_phrases: string[]
          formatting_preferences: string | null
          id: string
          name: string
          organization_id: string
          preferred_terminology: string | null
          reading_level: string | null
          sentence_preferences: string | null
          spelling_locale: string | null
          tone: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          em_dash_forbidden?: boolean
          forbidden_phrases?: string[]
          formatting_preferences?: string | null
          id?: string
          name: string
          organization_id: string
          preferred_terminology?: string | null
          reading_level?: string | null
          sentence_preferences?: string | null
          spelling_locale?: string | null
          tone?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          em_dash_forbidden?: boolean
          forbidden_phrases?: string[]
          formatting_preferences?: string | null
          id?: string
          name?: string
          organization_id?: string
          preferred_terminology?: string | null
          reading_level?: string | null
          sentence_preferences?: string | null
          spelling_locale?: string | null
          tone?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "brand_profiles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      brief_internal_links: {
        Row: {
          anchor_text: string
          brief_version_id: string
          id: string
          target_url: string
        }
        Insert: {
          anchor_text: string
          brief_version_id: string
          id?: string
          target_url: string
        }
        Update: {
          anchor_text?: string
          brief_version_id?: string
          id?: string
          target_url?: string
        }
        Relationships: [
          {
            foreignKeyName: "brief_internal_links_brief_version_id_fkey"
            columns: ["brief_version_id"]
            isOneToOne: false
            referencedRelation: "brief_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      brief_topics: {
        Row: {
          brief_version_id: string
          id: string
          label: string
        }
        Insert: {
          brief_version_id: string
          id?: string
          label: string
        }
        Update: {
          brief_version_id?: string
          id?: string
          label?: string
        }
        Relationships: [
          {
            foreignKeyName: "brief_topics_brief_version_id_fkey"
            columns: ["brief_version_id"]
            isOneToOne: false
            referencedRelation: "brief_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      brief_versions: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          business_brand_alignment: string | null
          common_competitor_expectations: string | null
          content_brief_id: string
          content_objective: string | null
          created_at: string
          created_by: string | null
          entities_concepts: Json
          evidence_requirements: Json
          generated_at: string | null
          generation_run_id: string | null
          h1: string | null
          id: string
          meta_description: string | null
          model_id: string | null
          project_id: string
          prompt_version: string | null
          questions: Json
          research_limitations: string | null
          research_package_id: string | null
          search_intent_confidence: number | null
          search_intent_label: string | null
          search_intent_rationale: string | null
          secondary_topics: Json
          serp_interpretation: string | null
          status: Database["public"]["Enums"]["artifact_version_status"]
          target_audience: string | null
          things_to_avoid: Json
          title: string | null
          unique_value: string | null
          version: number
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          business_brand_alignment?: string | null
          common_competitor_expectations?: string | null
          content_brief_id: string
          content_objective?: string | null
          created_at?: string
          created_by?: string | null
          entities_concepts?: Json
          evidence_requirements?: Json
          generated_at?: string | null
          generation_run_id?: string | null
          h1?: string | null
          id?: string
          meta_description?: string | null
          model_id?: string | null
          project_id: string
          prompt_version?: string | null
          questions?: Json
          research_limitations?: string | null
          research_package_id?: string | null
          search_intent_confidence?: number | null
          search_intent_label?: string | null
          search_intent_rationale?: string | null
          secondary_topics?: Json
          serp_interpretation?: string | null
          status?: Database["public"]["Enums"]["artifact_version_status"]
          target_audience?: string | null
          things_to_avoid?: Json
          title?: string | null
          unique_value?: string | null
          version: number
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          business_brand_alignment?: string | null
          common_competitor_expectations?: string | null
          content_brief_id?: string
          content_objective?: string | null
          created_at?: string
          created_by?: string | null
          entities_concepts?: Json
          evidence_requirements?: Json
          generated_at?: string | null
          generation_run_id?: string | null
          h1?: string | null
          id?: string
          meta_description?: string | null
          model_id?: string | null
          project_id?: string
          prompt_version?: string | null
          questions?: Json
          research_limitations?: string | null
          research_package_id?: string | null
          search_intent_confidence?: number | null
          search_intent_label?: string | null
          search_intent_rationale?: string | null
          secondary_topics?: Json
          serp_interpretation?: string | null
          status?: Database["public"]["Enums"]["artifact_version_status"]
          target_audience?: string | null
          things_to_avoid?: Json
          title?: string | null
          unique_value?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "brief_versions_content_brief_id_fkey"
            columns: ["content_brief_id"]
            isOneToOne: false
            referencedRelation: "content_briefs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brief_versions_generation_run_id_fkey"
            columns: ["generation_run_id"]
            isOneToOne: false
            referencedRelation: "generation_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brief_versions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brief_versions_research_package_id_fkey"
            columns: ["research_package_id"]
            isOneToOne: false
            referencedRelation: "research_packages"
            referencedColumns: ["id"]
          },
        ]
      }
      business_profiles: {
        Row: {
          audience: string | null
          company: string
          conversion_goal: string | null
          created_at: string
          created_by: string | null
          id: string
          market: string | null
          organization_id: string
          preferred_cta: string | null
          prohibited_claims: string | null
          services: string | null
          updated_at: string
        }
        Insert: {
          audience?: string | null
          company: string
          conversion_goal?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          market?: string | null
          organization_id: string
          preferred_cta?: string | null
          prohibited_claims?: string | null
          services?: string | null
          updated_at?: string
        }
        Update: {
          audience?: string | null
          company?: string
          conversion_goal?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          market?: string | null
          organization_id?: string
          preferred_cta?: string | null
          prohibited_claims?: string | null
          services?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "business_profiles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      content_blueprints: {
        Row: {
          created_at: string
          current_version_id: string | null
          id: string
          project_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          current_version_id?: string | null
          id?: string
          project_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          current_version_id?: string | null
          id?: string
          project_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_blueprints_current_version_id_fkey"
            columns: ["current_version_id"]
            isOneToOne: false
            referencedRelation: "blueprint_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_blueprints_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: true
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      content_briefs: {
        Row: {
          created_at: string
          current_version_id: string | null
          id: string
          project_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          current_version_id?: string | null
          id?: string
          project_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          current_version_id?: string | null
          id?: string
          project_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_briefs_current_version_id_fkey"
            columns: ["current_version_id"]
            isOneToOne: false
            referencedRelation: "brief_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_briefs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: true
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      content_documents: {
        Row: {
          blueprint_node_id: string
          created_at: string
          current_version_id: string | null
          id: string
          project_id: string
          updated_at: string
        }
        Insert: {
          blueprint_node_id: string
          created_at?: string
          current_version_id?: string | null
          id?: string
          project_id: string
          updated_at?: string
        }
        Update: {
          blueprint_node_id?: string
          created_at?: string
          current_version_id?: string | null
          id?: string
          project_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_documents_blueprint_node_id_fkey"
            columns: ["blueprint_node_id"]
            isOneToOne: true
            referencedRelation: "blueprint_nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_documents_current_version_id_fkey"
            columns: ["current_version_id"]
            isOneToOne: false
            referencedRelation: "content_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_documents_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      content_versions: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          blueprint_node_id: string
          body: string
          content_document_id: string
          created_at: string
          created_by: string | null
          generation_run_id: string | null
          id: string
          model_id: string | null
          project_id: string
          prompt_version: string | null
          status: Database["public"]["Enums"]["content_version_status"]
          version: number
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          blueprint_node_id: string
          body?: string
          content_document_id: string
          created_at?: string
          created_by?: string | null
          generation_run_id?: string | null
          id?: string
          model_id?: string | null
          project_id: string
          prompt_version?: string | null
          status?: Database["public"]["Enums"]["content_version_status"]
          version: number
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          blueprint_node_id?: string
          body?: string
          content_document_id?: string
          created_at?: string
          created_by?: string | null
          generation_run_id?: string | null
          id?: string
          model_id?: string | null
          project_id?: string
          prompt_version?: string | null
          status?: Database["public"]["Enums"]["content_version_status"]
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "content_versions_blueprint_node_id_fkey"
            columns: ["blueprint_node_id"]
            isOneToOne: false
            referencedRelation: "blueprint_nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_versions_content_document_id_fkey"
            columns: ["content_document_id"]
            isOneToOne: false
            referencedRelation: "content_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_versions_generation_run_id_fkey"
            columns: ["generation_run_id"]
            isOneToOne: false
            referencedRelation: "generation_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_versions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      export_content_versions: {
        Row: {
          content_version_id: string
          export_id: string
          id: string
        }
        Insert: {
          content_version_id: string
          export_id: string
          id?: string
        }
        Update: {
          content_version_id?: string
          export_id?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "export_content_versions_content_version_id_fkey"
            columns: ["content_version_id"]
            isOneToOne: false
            referencedRelation: "content_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "export_content_versions_export_id_fkey"
            columns: ["export_id"]
            isOneToOne: false
            referencedRelation: "exports"
            referencedColumns: ["id"]
          },
        ]
      }
      export_files: {
        Row: {
          created_at: string
          export_id: string
          file_name: string
          format: string
          id: string
          storage_path: string
        }
        Insert: {
          created_at?: string
          export_id: string
          file_name: string
          format: string
          id?: string
          storage_path: string
        }
        Update: {
          created_at?: string
          export_id?: string
          file_name?: string
          format?: string
          id?: string
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "export_files_export_id_fkey"
            columns: ["export_id"]
            isOneToOne: false
            referencedRelation: "exports"
            referencedColumns: ["id"]
          },
        ]
      }
      exports: {
        Row: {
          blueprint_version_id: string | null
          brief_version_id: string | null
          completed_at: string | null
          formats: Json
          generation_run_id: string | null
          id: string
          project_id: string
          requested_at: string | null
          requested_by: string | null
          status: Database["public"]["Enums"]["export_status"]
        }
        Insert: {
          blueprint_version_id?: string | null
          brief_version_id?: string | null
          completed_at?: string | null
          formats?: Json
          generation_run_id?: string | null
          id?: string
          project_id: string
          requested_at?: string | null
          requested_by?: string | null
          status?: Database["public"]["Enums"]["export_status"]
        }
        Update: {
          blueprint_version_id?: string | null
          brief_version_id?: string | null
          completed_at?: string | null
          formats?: Json
          generation_run_id?: string | null
          id?: string
          project_id?: string
          requested_at?: string | null
          requested_by?: string | null
          status?: Database["public"]["Enums"]["export_status"]
        }
        Relationships: [
          {
            foreignKeyName: "exports_blueprint_version_id_fkey"
            columns: ["blueprint_version_id"]
            isOneToOne: false
            referencedRelation: "blueprint_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exports_brief_version_id_fkey"
            columns: ["brief_version_id"]
            isOneToOne: false
            referencedRelation: "brief_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exports_generation_run_id_fkey"
            columns: ["generation_run_id"]
            isOneToOne: false
            referencedRelation: "generation_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exports_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      generation_events: {
        Row: {
          created_at: string
          duration_ms: number | null
          event: string
          finished_at: string | null
          id: string
          metadata: Json
          project_id: string
          stage: Database["public"]["Enums"]["generation_stage"]
          started_at: string | null
          status: Database["public"]["Enums"]["generation_run_status"]
        }
        Insert: {
          created_at?: string
          duration_ms?: number | null
          event: string
          finished_at?: string | null
          id?: string
          metadata?: Json
          project_id: string
          stage: Database["public"]["Enums"]["generation_stage"]
          started_at?: string | null
          status: Database["public"]["Enums"]["generation_run_status"]
        }
        Update: {
          created_at?: string
          duration_ms?: number | null
          event?: string
          finished_at?: string | null
          id?: string
          metadata?: Json
          project_id?: string
          stage?: Database["public"]["Enums"]["generation_stage"]
          started_at?: string | null
          status?: Database["public"]["Enums"]["generation_run_status"]
        }
        Relationships: [
          {
            foreignKeyName: "generation_events_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      generation_runs: {
        Row: {
          artifact_persisted_at: string | null
          attempt_number: number
          completed_at: string | null
          created_at: string
          created_by: string | null
          duration_ms: number | null
          error: Json | null
          estimated_cost_usd: number | null
          finish_reason: string | null
          id: string
          input_ref: Json | null
          input_tokens: number | null
          metadata: Json
          model: string | null
          organization_id: string
          output_ref: Json | null
          output_tokens: number | null
          progress: number | null
          project_id: string
          provider: string | null
          provider_completed_at: string | null
          provider_request_id: string | null
          retry_of_generation_run: string | null
          started_at: string | null
          status: Database["public"]["Enums"]["generation_run_status"]
          total_tokens: number | null
          type: Database["public"]["Enums"]["generation_run_type"]
          updated_at: string
          workflow_run_id: string | null
        }
        Insert: {
          artifact_persisted_at?: string | null
          attempt_number?: number
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          duration_ms?: number | null
          error?: Json | null
          estimated_cost_usd?: number | null
          finish_reason?: string | null
          id?: string
          input_ref?: Json | null
          input_tokens?: number | null
          metadata?: Json
          model?: string | null
          organization_id: string
          output_ref?: Json | null
          output_tokens?: number | null
          progress?: number | null
          project_id: string
          provider?: string | null
          provider_completed_at?: string | null
          provider_request_id?: string | null
          retry_of_generation_run?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["generation_run_status"]
          total_tokens?: number | null
          type: Database["public"]["Enums"]["generation_run_type"]
          updated_at?: string
          workflow_run_id?: string | null
        }
        Update: {
          artifact_persisted_at?: string | null
          attempt_number?: number
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          duration_ms?: number | null
          error?: Json | null
          estimated_cost_usd?: number | null
          finish_reason?: string | null
          id?: string
          input_ref?: Json | null
          input_tokens?: number | null
          metadata?: Json
          model?: string | null
          organization_id?: string
          output_ref?: Json | null
          output_tokens?: number | null
          progress?: number | null
          project_id?: string
          provider?: string | null
          provider_completed_at?: string | null
          provider_request_id?: string | null
          retry_of_generation_run?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["generation_run_status"]
          total_tokens?: number | null
          type?: Database["public"]["Enums"]["generation_run_type"]
          updated_at?: string
          workflow_run_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "generation_runs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generation_runs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generation_runs_retry_of_generation_run_fkey"
            columns: ["retry_of_generation_run"]
            isOneToOne: false
            referencedRelation: "generation_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      internal_link_candidates: {
        Row: {
          anchor_text_suggestion: string | null
          confidence: number | null
          created_at: string
          id: string
          project_id: string
          reason: string | null
          url: string
          website_dataset_id: string | null
        }
        Insert: {
          anchor_text_suggestion?: string | null
          confidence?: number | null
          created_at?: string
          id?: string
          project_id: string
          reason?: string | null
          url: string
          website_dataset_id?: string | null
        }
        Update: {
          anchor_text_suggestion?: string | null
          confidence?: number | null
          created_at?: string
          id?: string
          project_id?: string
          reason?: string | null
          url?: string
          website_dataset_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "internal_link_candidates_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "internal_link_candidates_website_dataset_id_fkey"
            columns: ["website_dataset_id"]
            isOneToOne: false
            referencedRelation: "website_datasets"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          auth_provider: string
          created_at: string
          display_name: string | null
          organization_id: string
          role: Database["public"]["Enums"]["user_role"]
          updated_at: string
          user_id: string
        }
        Insert: {
          auth_provider?: string
          created_at?: string
          display_name?: string | null
          organization_id: string
          role: Database["public"]["Enums"]["user_role"]
          updated_at?: string
          user_id: string
        }
        Update: {
          auth_provider?: string
          created_at?: string
          display_name?: string | null
          organization_id?: string
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      project_files: {
        Row: {
          created_at: string
          file_name: string
          file_type: Database["public"]["Enums"]["project_file_type"]
          id: string
          mime_type: string | null
          project_id: string
          size_bytes: number
          storage_path: string
          uploaded_by: string | null
          validation_error: string | null
          validation_status: Database["public"]["Enums"]["file_validation_status"]
        }
        Insert: {
          created_at?: string
          file_name: string
          file_type: Database["public"]["Enums"]["project_file_type"]
          id?: string
          mime_type?: string | null
          project_id: string
          size_bytes: number
          storage_path: string
          uploaded_by?: string | null
          validation_error?: string | null
          validation_status?: Database["public"]["Enums"]["file_validation_status"]
        }
        Update: {
          created_at?: string
          file_name?: string
          file_type?: Database["public"]["Enums"]["project_file_type"]
          id?: string
          mime_type?: string | null
          project_id?: string
          size_bytes?: number
          storage_path?: string
          uploaded_by?: string | null
          validation_error?: string | null
          validation_status?: Database["public"]["Enums"]["file_validation_status"]
        }
        Relationships: [
          {
            foreignKeyName: "project_files_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_members: {
        Row: {
          added_by: string | null
          created_at: string
          id: string
          project_id: string
          user_id: string
        }
        Insert: {
          added_by?: string | null
          created_at?: string
          id?: string
          project_id: string
          user_id: string
        }
        Update: {
          added_by?: string | null
          created_at?: string
          id?: string
          project_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_members_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          brand_profile_id: string | null
          business_profile_id: string | null
          content_type: Database["public"]["Enums"]["content_type"]
          created_at: string
          created_by: string | null
          current_research_package_id: string | null
          current_website_dataset_id: string | null
          generation_state: Database["public"]["Enums"]["generation_state"]
          id: string
          instructions: string | null
          market: string | null
          name: string
          organization_id: string
          primary_topic: string | null
          status: Database["public"]["Enums"]["project_status"]
          target_query: string | null
          updated_at: string
        }
        Insert: {
          brand_profile_id?: string | null
          business_profile_id?: string | null
          content_type: Database["public"]["Enums"]["content_type"]
          created_at?: string
          created_by?: string | null
          current_research_package_id?: string | null
          current_website_dataset_id?: string | null
          generation_state?: Database["public"]["Enums"]["generation_state"]
          id?: string
          instructions?: string | null
          market?: string | null
          name: string
          organization_id: string
          primary_topic?: string | null
          status?: Database["public"]["Enums"]["project_status"]
          target_query?: string | null
          updated_at?: string
        }
        Update: {
          brand_profile_id?: string | null
          business_profile_id?: string | null
          content_type?: Database["public"]["Enums"]["content_type"]
          created_at?: string
          created_by?: string | null
          current_research_package_id?: string | null
          current_website_dataset_id?: string | null
          generation_state?: Database["public"]["Enums"]["generation_state"]
          id?: string
          instructions?: string | null
          market?: string | null
          name?: string
          organization_id?: string
          primary_topic?: string | null
          status?: Database["public"]["Enums"]["project_status"]
          target_query?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_brand_profile_id_fkey"
            columns: ["brand_profile_id"]
            isOneToOne: false
            referencedRelation: "brand_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_business_profile_id_fkey"
            columns: ["business_profile_id"]
            isOneToOne: false
            referencedRelation: "business_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_current_research_package_id_fkey"
            columns: ["current_research_package_id"]
            isOneToOne: false
            referencedRelation: "research_packages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_current_website_dataset_id_fkey"
            columns: ["current_website_dataset_id"]
            isOneToOne: false
            referencedRelation: "website_datasets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      qa_findings: {
        Row: {
          category: Database["public"]["Enums"]["qa_category"]
          created_at: string
          id: string
          method: Database["public"]["Enums"]["qa_method"]
          note: string | null
          qa_report_id: string
          status: Database["public"]["Enums"]["qa_status"]
        }
        Insert: {
          category: Database["public"]["Enums"]["qa_category"]
          created_at?: string
          id?: string
          method: Database["public"]["Enums"]["qa_method"]
          note?: string | null
          qa_report_id: string
          status: Database["public"]["Enums"]["qa_status"]
        }
        Update: {
          category?: Database["public"]["Enums"]["qa_category"]
          created_at?: string
          id?: string
          method?: Database["public"]["Enums"]["qa_method"]
          note?: string | null
          qa_report_id?: string
          status?: Database["public"]["Enums"]["qa_status"]
        }
        Relationships: [
          {
            foreignKeyName: "qa_findings_qa_report_id_fkey"
            columns: ["qa_report_id"]
            isOneToOne: false
            referencedRelation: "qa_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      qa_report_content_versions: {
        Row: {
          content_version_id: string
          id: string
          qa_report_id: string
        }
        Insert: {
          content_version_id: string
          id?: string
          qa_report_id: string
        }
        Update: {
          content_version_id?: string
          id?: string
          qa_report_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "qa_report_content_versions_content_version_id_fkey"
            columns: ["content_version_id"]
            isOneToOne: false
            referencedRelation: "content_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qa_report_content_versions_qa_report_id_fkey"
            columns: ["qa_report_id"]
            isOneToOne: false
            referencedRelation: "qa_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      qa_reports: {
        Row: {
          blueprint_version_id: string | null
          brief_version_id: string | null
          generation_run_id: string | null
          id: string
          overall_status: Database["public"]["Enums"]["qa_status"] | null
          project_id: string
          run_at: string
          triggered_by: string | null
        }
        Insert: {
          blueprint_version_id?: string | null
          brief_version_id?: string | null
          generation_run_id?: string | null
          id?: string
          overall_status?: Database["public"]["Enums"]["qa_status"] | null
          project_id: string
          run_at?: string
          triggered_by?: string | null
        }
        Update: {
          blueprint_version_id?: string | null
          brief_version_id?: string | null
          generation_run_id?: string | null
          id?: string
          overall_status?: Database["public"]["Enums"]["qa_status"] | null
          project_id?: string
          run_at?: string
          triggered_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "qa_reports_blueprint_version_id_fkey"
            columns: ["blueprint_version_id"]
            isOneToOne: false
            referencedRelation: "blueprint_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qa_reports_brief_version_id_fkey"
            columns: ["brief_version_id"]
            isOneToOne: false
            referencedRelation: "brief_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qa_reports_generation_run_id_fkey"
            columns: ["generation_run_id"]
            isOneToOne: false
            referencedRelation: "generation_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qa_reports_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      research_packages: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          parsed_summary: Json | null
          project_file_id: string | null
          project_id: string
          status: Database["public"]["Enums"]["upload_status"]
          topic_conflict_details: Json | null
          topic_conflict_flag: boolean
          updated_at: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          parsed_summary?: Json | null
          project_file_id?: string | null
          project_id: string
          status?: Database["public"]["Enums"]["upload_status"]
          topic_conflict_details?: Json | null
          topic_conflict_flag?: boolean
          updated_at?: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          parsed_summary?: Json | null
          project_file_id?: string | null
          project_id?: string
          status?: Database["public"]["Enums"]["upload_status"]
          topic_conflict_details?: Json | null
          topic_conflict_flag?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "research_packages_project_file_id_fkey"
            columns: ["project_file_id"]
            isOneToOne: false
            referencedRelation: "project_files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "research_packages_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      research_sources: {
        Row: {
          created_at: string
          id: string
          payload: Json
          research_package_id: string
          type: Database["public"]["Enums"]["research_source_type"]
        }
        Insert: {
          created_at?: string
          id?: string
          payload: Json
          research_package_id: string
          type: Database["public"]["Enums"]["research_source_type"]
        }
        Update: {
          created_at?: string
          id?: string
          payload?: Json
          research_package_id?: string
          type?: Database["public"]["Enums"]["research_source_type"]
        }
        Relationships: [
          {
            foreignKeyName: "research_sources_research_package_id_fkey"
            columns: ["research_package_id"]
            isOneToOne: false
            referencedRelation: "research_packages"
            referencedColumns: ["id"]
          },
        ]
      }
      settings: {
        Row: {
          ai_model_id: string | null
          created_at: string
          file_size_limits: Json
          id: string
          organization_id: string
          strict_approval_gate: boolean
          structured_json_export_enabled: boolean
          updated_at: string
        }
        Insert: {
          ai_model_id?: string | null
          created_at?: string
          file_size_limits?: Json
          id?: string
          organization_id: string
          strict_approval_gate?: boolean
          structured_json_export_enabled?: boolean
          updated_at?: string
        }
        Update: {
          ai_model_id?: string | null
          created_at?: string
          file_size_limits?: Json
          id?: string
          organization_id?: string
          strict_approval_gate?: boolean
          structured_json_export_enabled?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "settings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      website_datasets: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          parsed_summary: Json | null
          project_id: string
          screaming_frog_project_file_id: string | null
          sitemap_project_file_id: string | null
          status: Database["public"]["Enums"]["upload_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          parsed_summary?: Json | null
          project_id: string
          screaming_frog_project_file_id?: string | null
          sitemap_project_file_id?: string | null
          status?: Database["public"]["Enums"]["upload_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          parsed_summary?: Json | null
          project_id?: string
          screaming_frog_project_file_id?: string | null
          sitemap_project_file_id?: string | null
          status?: Database["public"]["Enums"]["upload_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "website_datasets_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "website_datasets_screaming_frog_project_file_id_fkey"
            columns: ["screaming_frog_project_file_id"]
            isOneToOne: false
            referencedRelation: "project_files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "website_datasets_sitemap_project_file_id_fkey"
            columns: ["sitemap_project_file_id"]
            isOneToOne: false
            referencedRelation: "project_files"
            referencedColumns: ["id"]
          },
        ]
      }
      website_urls: {
        Row: {
          created_at: string
          h1: string | null
          id: string
          indexable: boolean | null
          metadata: Json | null
          source: Database["public"]["Enums"]["website_url_source"]
          status_code: number | null
          title: string | null
          url: string
          website_dataset_id: string
        }
        Insert: {
          created_at?: string
          h1?: string | null
          id?: string
          indexable?: boolean | null
          metadata?: Json | null
          source: Database["public"]["Enums"]["website_url_source"]
          status_code?: number | null
          title?: string | null
          url: string
          website_dataset_id: string
        }
        Update: {
          created_at?: string
          h1?: string | null
          id?: string
          indexable?: boolean | null
          metadata?: Json | null
          source?: Database["public"]["Enums"]["website_url_source"]
          status_code?: number | null
          title?: string | null
          url?: string
          website_dataset_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "website_urls_website_dataset_id_fkey"
            columns: ["website_dataset_id"]
            isOneToOne: false
            referencedRelation: "website_datasets"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      can_access_project: {
        Args: { target_project_id: string }
        Returns: boolean
      }
      current_app_role: {
        Args: never
        Returns: Database["public"]["Enums"]["user_role"]
      }
      current_organization_id: { Args: never; Returns: string }
    }
    Enums: {
      artifact_version_status: "draft" | "approved"
      content_type: "blog_post" | "landing_page" | "comparison_page" | "guide"
      content_version_status: "ai_generated" | "approved"
      export_status: "idle" | "running" | "done" | "failed"
      file_validation_status: "pending" | "valid" | "rejected"
      generation_run_status:
        | "queued"
        | "running"
        | "provider_completed"
        | "artifact_persisted"
        | "completed"
        | "failed"
        | "cancelled"
      generation_run_type:
        | "research_parse"
        | "website_parse"
        | "brief_generate"
        | "blueprint_generate"
        | "content_generate"
        | "qa_run"
        | "export"
      generation_stage: "strategy" | "blueprint" | "content" | "qa" | "export"
      generation_state:
        | "draft"
        | "strategy_pending"
        | "strategy_generating"
        | "strategy_completed"
        | "blueprint_pending"
        | "blueprint_generating"
        | "blueprint_completed"
        | "content_pending"
        | "content_generating"
        | "content_completed"
        | "qa_pending"
        | "qa_running"
        | "qa_completed"
        | "export_pending"
        | "export_completed"
        | "failed"
      project_file_type:
        | "research_csv"
        | "research_markdown"
        | "research_docx"
        | "sitemap_xml"
        | "screaming_frog_csv"
      project_status:
        | "draft"
        | "ingesting"
        | "ready_for_brief"
        | "brief_generated"
        | "brief_changes_requested"
        | "brief_approved"
        | "blueprint_generated"
        | "blueprint_changes_requested"
        | "blueprint_approved"
        | "generating_content"
        | "content_ready"
        | "qa_failed"
        | "qa_warning"
        | "ready_for_export"
        | "exported"
        | "failed"
      qa_category:
        | "intent"
        | "topics"
        | "entities"
        | "structure"
        | "links"
        | "brand"
        | "factual"
        | "style"
        | "forbidden_chars"
      qa_method: "deterministic" | "llm"
      qa_status: "pass" | "warn" | "fail"
      research_source_type:
        | "topic"
        | "primary_query"
        | "secondary_queries"
        | "location"
        | "organic_results"
        | "parsed_pages"
        | "failed_urls"
        | "field_averages"
        | "common_ground_topics"
        | "competitor_unique_sections"
        | "serp_features"
        | "ai_overview"
        | "paa"
        | "related_searches"
        | "content_gaps"
        | "format_signals"
        | "external_source_signals"
        | "raw_competitor_content"
        | "research_warnings"
      upload_status: "idle" | "uploading" | "parsing" | "parsed" | "failed"
      user_role: "team_lead" | "seo_manager" | "content_writer"
      website_url_source: "sitemap" | "screaming_frog" | "both"
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      artifact_version_status: ["draft", "approved"],
      content_type: ["blog_post", "landing_page", "comparison_page", "guide"],
      content_version_status: ["ai_generated", "approved"],
      export_status: ["idle", "running", "done", "failed"],
      file_validation_status: ["pending", "valid", "rejected"],
      generation_run_status: [
        "queued",
        "running",
        "provider_completed",
        "artifact_persisted",
        "completed",
        "failed",
        "cancelled",
      ],
      generation_run_type: [
        "research_parse",
        "website_parse",
        "brief_generate",
        "blueprint_generate",
        "content_generate",
        "qa_run",
        "export",
      ],
      generation_stage: ["strategy", "blueprint", "content", "qa", "export"],
      generation_state: [
        "draft",
        "strategy_pending",
        "strategy_generating",
        "strategy_completed",
        "blueprint_pending",
        "blueprint_generating",
        "blueprint_completed",
        "content_pending",
        "content_generating",
        "content_completed",
        "qa_pending",
        "qa_running",
        "qa_completed",
        "export_pending",
        "export_completed",
        "failed",
      ],
      project_file_type: [
        "research_csv",
        "research_markdown",
        "research_docx",
        "sitemap_xml",
        "screaming_frog_csv",
      ],
      project_status: [
        "draft",
        "ingesting",
        "ready_for_brief",
        "brief_generated",
        "brief_changes_requested",
        "brief_approved",
        "blueprint_generated",
        "blueprint_changes_requested",
        "blueprint_approved",
        "generating_content",
        "content_ready",
        "qa_failed",
        "qa_warning",
        "ready_for_export",
        "exported",
        "failed",
      ],
      qa_category: [
        "intent",
        "topics",
        "entities",
        "structure",
        "links",
        "brand",
        "factual",
        "style",
        "forbidden_chars",
      ],
      qa_method: ["deterministic", "llm"],
      qa_status: ["pass", "warn", "fail"],
      research_source_type: [
        "topic",
        "primary_query",
        "secondary_queries",
        "location",
        "organic_results",
        "parsed_pages",
        "failed_urls",
        "field_averages",
        "common_ground_topics",
        "competitor_unique_sections",
        "serp_features",
        "ai_overview",
        "paa",
        "related_searches",
        "content_gaps",
        "format_signals",
        "external_source_signals",
        "raw_competitor_content",
        "research_warnings",
      ],
      upload_status: ["idle", "uploading", "parsing", "parsed", "failed"],
      user_role: ["team_lead", "seo_manager", "content_writer"],
      website_url_source: ["sitemap", "screaming_frog", "both"],
    },
  },
} as const
