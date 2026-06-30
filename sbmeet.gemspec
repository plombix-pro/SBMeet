require_relative "lib/sbmeet/version"

Gem::Specification.new do |spec|
  spec.name          = "sbmeet"
  spec.version       = Sbmeet::VERSION
  spec.authors       = ["Stéphane Ballet"] 
  spec.email         = ["plombix@gmail.com"]
  spec.summary       = "A turnkey WebRTC video conferencing for Rails."
  spec.description   = "SBMeet injects a complete, production-ready P2P WebRTC video conferencing system directly into a Rails application."
  spec.homepage      = "https://github.com/plombix-pro/SBMeet"
  spec.license       = "MIT"
  spec.required_ruby_version = ">= 3.0.0"
  spec.metadata["homepage_uri"] = spec.homepage
  spec.metadata["source_code_uri"] = "https://github.com/plombix-pro/SBMeet"
  spec.metadata["bug_tracker_uri"] = "https://github.com/plombix-pro/SBMeet/issues"

  spec.files = Dir.chdir(File.expand_path(__dir__)) do
    `git ls-files -z`.split("\x0").reject { |f| f.match(%r{\A(?:(?:test|spec|features)/|\.(?:git|travis|circleci)|appveyor)}) }
  end
  
  spec.bindir        = "exe"
  spec.executables   = spec.files.grep(%r{\Aexe/}) { |f| File.basename(f) }
  spec.require_paths = ["lib"]
  
  spec.add_dependency "rails", ">= 7.0.0"
end
