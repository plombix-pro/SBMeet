require "rails/generators/active_record"

module Sbmeet
  module Generators
    class InstallGenerator < Rails::Generators::Base
      include Rails::Generators::Migration
      source_root File.expand_path("templates", __dir__)
      desc "Injects the complete SBMeet WebRTC infrastructure into the host application."

      def check_host_authentication_capabilities
        say "Analyzing host application environment...", :yellow
        Rails.application.eager_load!
        
        user_model_path = "app/models/user.rb"

        if ApplicationController.new.respond_to?(:current_user, true)
          say_status :success, "Found 'current_user' definition.", :green

          if ::File.exist?(user_model_path)
            user_methods = defined?(User) ? User.instance_methods : []

            if user_methods.include?(:admin?)
              say_status :success, "Found 'admin?' method on the User model.", :green
            else
              say_status :warning, "User model found, but 'admin?' is missing.", :yellow
              method_injection = <<~RUBY
                  # Added by SBMeet Installer
                  def admin?
                    Rails.env.development? || Rails.env.test?
                  end
              RUBY

              inject_into_file user_model_path, method_injection, after: /class User < ApplicationRecord.*\n/
              say_status :insert, "Added fallback admin? method to #{user_model_path}", :green
            end
          else
            say_status :error, "Could not find a standard 'User' model file at #{user_model_path}.", :red
            exit 1
          end
        else
          say_status :error, "No 'current_user' method detected in ApplicationController.", :red
          say "Make sure you install and configure an authentication library (like Devise) before using SBMeet.", :white
          exit 1
        end
      end

      def check_if_pg
        unless File.read("config/database.yml").include?("postgresql")
          say_status :error, "SBMeet requires PostgreSQL for ActionCable signaling.", :red
          exit 1
        end
      end

      def verify_and_update_application_js
        target_file = "app/javascript/application.js"

        unless File.exist?(target_file)
          say_status :error, "SBMeet requires a configured JavaScript asset pipeline.", :red
          exit 1
        end

        js_content = File.read(target_file)

        unless js_content.include?('import "channels"') || js_content.include?("import './channels'")
          say_status :insert, "Appending channels import to application.js", :green
          append_to_file target_file, "\nimport \"channels\""
        end
      end

      def self.next_migration_number(dirname)
        ActiveRecord::Generators::Base.next_migration_number(dirname)
      end

      def setup_database
        migration_template "migrations/create_rooms.rb.erb", "db/migrate/create_rooms.rb"
        say_status :success, "Created Room model migration.", :green
      end

      def verify_devise
        has_devise_gem = File.read("Gemfile").include?("gem 'devise'")
        has_devise_model = File.exist?("app/models/user.rb") && File.read("app/models/user.rb").include?("devise :")

        if has_devise_gem && has_devise_model
          say_status :success, "Devise authentication validated.", :green
        else
          say_status :warning, "Devise setup not fully detected. Check your configuration if connection errors occur.", :yellow
        end
      end

      def copy_application_logic
        copy_file "models/room.rb", "app/models/room.rb", force: true
        copy_file "controllers/rooms_controller.rb", "app/controllers/rooms_controller.rb", force: true
      end

      def copy_frontend_assets
        copy_file "javascript/room_controller.js", "app/javascript/controllers/room_controller.js", force: true
        copy_file "javascript/index.js", "app/javascript/controllers/index.js", force: true
        
        directory "javascript/channels", "app/javascript/channels", force: true
        directory "views/rooms", "app/views/rooms", force: true
      end

      def inject_bootstrap_if_missing
        has_bootstrap = ((File.exist?("config/importmap.rb") && File.read("config/importmap.rb").include?("bootstrap")) ||
                         (File.exist?("package.json") && File.read("package.json").include?("bootstrap")) ||
                         (File.exist?("app/assets/stylesheets/application.bootstrap.scss")))

        unless has_bootstrap
          say_status :info, "Injecting Bootstrap 5 CDN into room views.", :yellow
          prepend_file "app/views/rooms/show.html.erb", "<link href=\"https://cdn.jsdelivr.net/npm/bootstrap@5.0.2/dist/css/bootstrap.min.css\" rel=\"stylesheet\">\n"
          prepend_file "app/views/rooms/index.html.erb", "<link href=\"https://cdn.jsdelivr.net/npm/bootstrap@5.0.2/dist/css/bootstrap.min.css\" rel=\"stylesheet\">\n"
        end
      end

      def setup_action_cable
        # Overwrite cable configuration with your PG/Redis required layout
        template "config/cable.yml", "config/cable.yml", force: true

        copy_file "channels/signaling_channel.rb", "app/channels/signaling_channel.rb", force: true

        # FIXED: Use force: true to overwrite default empty Rails framework files
        copy_file "channels/connection.rb", "app/channels/application_cable/connection.rb", force: true
        copy_file "channels/channel.rb", "app/channels/application_cable/channel.rb", force: true
      end

      def setup_javascript_dependencies
        if File.exist?("config/importmap.rb")
          importmap_content = File.read("config/importmap.rb")
          
          unless importmap_content.include?('"@rails/actioncable"')
            append_to_file "config/importmap.rb", "\npin \"@rails/actioncable\", to: \"actioncable.esm.js\""
          end
          unless importmap_content.include?('pin_all_from "app/javascript/channels"')
            append_to_file "config/importmap.rb", "\npin_all_from \"app/javascript/channels\", under: \"channels\""
          end
          unless importmap_content.include?('pin_all_from "app/javascript/controllers"')
            append_to_file "config/importmap.rb", "\npin_all_from \"app/javascript/controllers\", under: \"controllers\""
          end
        end
      end

      def inject_routes
        route "resources :rooms, only: [:index, :show, :new, :create, :destroy]"
      end
    end
  end
end